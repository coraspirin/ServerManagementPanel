import { serverT } from "@/lib/i18n/runtime";
import { guardApi } from "@/lib/auth/api";
import { audit } from "@/lib/auth/audit";
import { activeTokenCount, createApiToken, listApiTokens } from "@/lib/auth/apitoken";
import { hasPermission } from "@/lib/auth/session";
import type { PermissionKey } from "@/lib/auth/types";
import { tokenAuditTag } from "@/lib/apiv1/redact";
import { clientIp } from "@/lib/request";
import { getNumber } from "@/lib/settings";

export const dynamic = "force-dynamic";

/**
 * API anahtarı yönetimi (T12).
 *
 * Bu uç PANELİN KENDİ arayüzü için — çerez + CSRF ile, `guardApi` üzerinden.
 * Bilerek /api/v1 altında değil: bir anahtarla yeni anahtar üretebilmek,
 * sızmış tek bir anahtarı kalıcı erişime çevirirdi.
 */

/** Token yoluyla asla verilmeyecek izinler — seçicide de listelenmez. */
const NEVER_FOR_TOKENS: ReadonlySet<string> = new Set(["docker.exec", "host.shell"]);

export async function GET(request: Request) {
  const guard = await guardApi(request, "api.manage");
  if (!guard.ok) return guard.response;

  const user = guard.session.user;
  const wantsAll = new URL(request.url).searchParams.get("all") === "1";
  // Yöneticinin tüm anahtarları görebilmesi gerekiyor: bir kullanıcı işten
  // ayrıldığında onun anahtarlarını kim iptal edecek sorusunun cevabı bu.
  const canSeeAll = hasPermission(user, "users.manage");

  const tokens = listApiTokens(wantsAll && canSeeAll ? {} : { userId: user.id });

  return Response.json({
    tokens,
    scope: wantsAll && canSeeAll ? "all" : "own",
    canSeeAll,
    activeCount: activeTokenCount(user.id),
    maxTokens: getNumber("api.max_tokens_per_user"),
    defaultTtlDays: getNumber("api.token_default_ttl_days"),
    /*
     * Seçilebilir izinler: kullanıcının KENDİ izinleri eksi hiç
     * verilmeyecekler. Sunucu tarafında da doğrulanıyor (aşağıda) — bu liste
     * yalnızca arayüzü doldurmak için, sınır değil.
     */
    grantablePermissions: user.permissions.filter((key) => !NEVER_FOR_TOKENS.has(key)),
  });
}

export async function POST(request: Request) {
  const guard = await guardApi(request, "api.manage");
  if (!guard.ok) return guard.response;

  const user = guard.session.user;

  let body: { name?: unknown; permissions?: unknown; expiresInDays?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: serverT("api.invalidRequest") }, { status: 400 });
  }

  const name = String(body.name ?? "").trim();
  if (!name) return Response.json({ error: serverT("api.tokens.nameRequired") }, { status: 400 });
  if (name.length > 80) {
    return Response.json({ error: serverT("api.tokens.nameTooLong") }, { status: 400 });
  }

  const max = getNumber("api.max_tokens_per_user");
  if (activeTokenCount(user.id) >= max) {
    return Response.json(
      { error: serverT("api.tokens.limit", { max }) },
      { status: 400 },
    );
  }

  const requested = Array.isArray(body.permissions) ? body.permissions.map(String) : [];
  /*
   * ⚠️ Asıl sınır burada, arayüzdeki listede değil. Kullanıcı isteği elle
   * hazırlayıp sahip olmadığı bir izni yazabilir; kesişim onu düşürür.
   * `resolveApiToken` her istekte kesişimi TEKRAR alıyor, yani bu satır
   * atlansa bile yetki genişlemezdi — ama o zaman anahtar, hiç işe yaramayan
   * izinler taşıyan yanıltıcı bir kayıt olurdu.
   */
  const permissions = requested.filter(
    (key): key is PermissionKey =>
      !NEVER_FOR_TOKENS.has(key) && user.permissions.includes(key as PermissionKey),
  );

  if (permissions.length === 0) {
    return Response.json({ error: serverT("api.tokens.permissionRequired") }, { status: 400 });
  }

  const rawTtl = Number(body.expiresInDays ?? getNumber("api.token_default_ttl_days"));
  const expiresInDays = Number.isFinite(rawTtl) ? Math.max(Math.trunc(rawTtl), 0) : 0;

  const created = createApiToken({
    name,
    userId: user.id,
    username: user.username,
    permissions,
    expiresInDays: expiresInDays === 0 ? null : expiresInDays,
  });

  // Önek audit'e YAZILIR, değer asla: "hangi anahtar üretildi" sorusu ileride
  // yalnızca bu satırdan cevaplanabilir ve önek tek başına kullanılamaz.
  const prefix = created.token.slice(0, 12);

  audit({
    userId: user.id,
    username: user.username,
    action: "api.token_create",
    targetType: "api_token",
    targetId: String(created.id),
    detail: `${tokenAuditTag(name, prefix)} ${permissions.join(", ")} · ${expiresInDays === 0 ? serverT("api.noExpiry") : serverT("api.days", { count: expiresInDays })}`,
    ip: clientIp(request),
    result: "ok",
  });

  // Düz değer YALNIZCA burada. Bir daha üretilemez; saklanan tek şey özeti.
  return Response.json({ ok: true, id: created.id, token: created.token });
}
