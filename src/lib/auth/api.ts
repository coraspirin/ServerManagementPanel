import "server-only";
import { serverT } from "@/lib/i18n/runtime";

import { currentSession, hasPermission } from "./session";
import { CSRF_HEADER, type ActiveSession, type PermissionKey } from "./types";
import { safeEquals } from "@/lib/crypto";
import { enterHost, runWithHost } from "@/lib/hosts/context";
import { HOST_ERROR_STATUS, isHostError } from "@/lib/hosts/errors";
import { resolveRequestHost } from "@/lib/hosts/request";
import { getHost, isLocalHost, listHosts } from "@/lib/hosts/store";

/**
 * Route handler'lar için yetki kapısı.
 *
 * Başarısızlıkta hazır bir `Response` döndürür; çağıran taraf onu doğrudan
 * return eder. Böylece her uçta aynı kontrolleri tekrar yazmak gerekmez.
 */
export type ApiGuardResult =
  | { ok: true; session: ActiveSession }
  | { ok: false; response: Response };

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export async function guardApi(
  request: Request,
  permission: PermissionKey,
): Promise<ApiGuardResult> {
  const session = await currentSession();

  if (!session) {
    return {
      ok: false,
      response: Response.json({ error: serverT("api.auth.sessionRequired") }, { status: 401 }),
    };
  }

  // T6 — CSRF: durum değiştiren isteklerde double-submit token doğrulaması.
  // Çerez JS'e açık, başlık ise yalnızca aynı köken üzerinden gönderilebilir.
  if (!SAFE_METHODS.has(request.method)) {
    const header = request.headers.get(CSRF_HEADER) ?? "";
    if (!header || !safeEquals(header, session.csrfToken)) {
      return {
        ok: false,
        response: Response.json({ error: serverT("apiv1.csrfFailed") }, { status: 403 }),
      };
    }
  }

  if (!hasPermission(session.user, permission)) {
    return {
      ok: false,
      response: Response.json({ error: serverT("apiv1.forbidden") }, { status: 403 }),
    };
  }

  return { ok: true, session };
}

export type HostGuardResult =
  | { ok: true; session: ActiveSession; hostId: number }
  | { ok: false; response: Response };

/**
 * `guardApi` + istekteki sunucu seçimi. Başarılıysa bağlamı da kurar:
 *
 *   const guard = await guardHostApi(request, "docker.view");
 *   if (!guard.ok) return guard.response;
 *   enterHost(guard.hostId);
 *
 * `enterHost` çağıranda olmalı: bu fonksiyonun içinde kurulan bağlam
 * `await` dönüşünde çağırana geçmez.
 *
 * `localOnly`: özellik yalnızca panelin kendi sunucusunda var (host cron,
 * ufw, LAN taraması...). Uzak sunucu seçiliyken 501 döner.
 *
 * `agent`: uç panel-agent üzerinden çalışacak şekilde taşındı (yalnızca
 * sağlayıcılar/ajan işlemleri kullanıyor). İşaretsiz uçlar ajan sunucusunda
 * 501 döner — yerel dosya sistemine ya da helper'a doğrudan dokunan bir uç,
 * uzak sunucu seçiliyken MERKEZİN verisini gösterirdi.
 */
export async function guardHostApi(
  request: Request,
  permission: PermissionKey,
  options: { localOnly?: boolean; agent?: boolean } = {},
): Promise<HostGuardResult> {
  const guard = await guardApi(request, permission);
  if (!guard.ok) return guard;

  const pick = resolveRequestHost(request);
  if (!pick.ok) {
    const key = pick.reason === "disabled" ? "hosts.errors.disabled" : "hosts.errors.unknown";
    return {
      ok: false,
      response: Response.json({ error: serverT(key, { host: pick.value }) }, { status: 404 }),
    };
  }

  if (!SAFE_METHODS.has(request.method) && !pick.explicit && listHosts().length > 1) {
    return {
      ok: false,
      response: Response.json({ error: serverT("hosts.errors.hostRequired") }, { status: 409 }),
    };
  }

  // Ulaşılamayan sunucuya istek hiç gönderilmez: her uç kendi zaman aşımını
  // beklemesin ve hata ham bir 500 yerine anlaşılır bir mesajla dönsün.
  const host = getHost(pick.hostId);
  if (host && !host.isLocal && (host.status === "offline" || host.status === "incompatible")) {
    return {
      ok: false,
      response: Response.json(
        { error: serverT(`hosts.errors.${host.status}`), code: host.status },
        { status: HOST_ERROR_STATUS[host.status] },
      ),
    };
  }

  const unsupported =
    (options.localOnly && !isLocalHost(pick.hostId)) ||
    (host?.agentType === "agent" && !options.agent);
  if (unsupported) {
    return {
      ok: false,
      response: Response.json(
        { error: serverT("hosts.errors.unsupported"), code: "unsupported" },
        { status: 501 },
      ),
    };
  }

  return { ok: true, session: guard.session, hostId: pick.hostId };
}

export { enterHost };

export type HostApiContext = { session: ActiveSession; hostId: number };

/**
 * Sunucu bazlı uçlar için yetki kapısı + sunucu bağlamı.
 *
 * Yetki kontrolünden sonra istekteki sunucu seçimi çözülür ve `handler`
 * o sunucunun bağlamında (`runWithHost`) çalıştırılır; alttaki kütüphane
 * kodu `currentHostId()` ile doğru sunucuyu görür.
 *
 * Birden fazla sunucu varken durum değiştiren istek sunucuyu AÇIKÇA (başlık
 * ya da sorgu) belirtmek zorunda: çerez sekmeler arasında ortak, başka bir
 * sekmede seçim değiştiyse "yeniden başlat" yanlış sunucuya gidebilirdi.
 */
export async function withHost(
  request: Request,
  permission: PermissionKey,
  handler: (ctx: HostApiContext) => Promise<Response> | Response,
): Promise<Response> {
  const guard = await guardHostApi(request, permission);
  if (!guard.ok) return guard.response;
  try {
    return await runWithHost(guard.hostId, () =>
      handler({ session: guard.session, hostId: guard.hostId }),
    );
  } catch (error) {
    if (!isHostError(error)) throw error;
    return Response.json(
      { error: serverT(`hosts.errors.${error.code}`), code: error.code },
      { status: HOST_ERROR_STATUS[error.code] },
    );
  }
}
