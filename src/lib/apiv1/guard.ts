import "server-only";

import { currentSession } from "@/lib/auth/session";
import { resolveApiToken, touchApiToken, type ResolveFailure } from "@/lib/auth/apitoken";
import { CSRF_HEADER, type PermissionKey } from "@/lib/auth/types";
import { safeEquals } from "@/lib/crypto";
import { getBool, getNumber } from "@/lib/settings";
import { apiError, rateLimited } from "./respond";
import { authLimiter, rateLimitIp, usageLimiter } from "./ratelimit";

/**
 * T12 — /api/v1 yetki kapısı.
 *
 * `guardApi` ile AYNI SÖZLEŞME ({ok:true,...} | {ok:false, response}), böylece
 * route gövdeleri birebir aynı görünür. Farklar:
 *   - Bearer varsa CSRF aranmaz (çerez gönderilmiyor, CSRF'nin koruduğu
 *     saldırı sınıfı yok).
 *   - Bearer yoksa çerez oturumuna düşer — panelin kendi arayüzü ve `curl -b`
 *     ile elle test eden insan da v1'i çağırabilsin.
 *   - Hata zarfı makine okunur.
 *
 * ⚠️ `api.enabled` ŞALTERİ BURADA, route'ta DEĞİL. Route başına yazılsaydı bir
 * gün biri yeni bir uç ekleyip unuturdu ve şalter kapalıyken açık kalan tek
 * bir uç, şalterin tamamını anlamsız kılardı. Bu yüzden indeks dâhil her v1
 * ucu buradan geçmek zorunda.
 */

export type ApiActor = {
  userId: number;
  username: string;
  permissions: PermissionKey[];
  via: "session" | "token";
  tokenId?: number;
  tokenName?: string;
  tokenPrefix?: string;
  ip: string;
};

export type GuardResult = { ok: true; actor: ApiActor } | { ok: false; response: Response };

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Token yolunda izin verilmeyen yetkiler.
 *
 * İki katmanlı savunmanın ikinci katmanı: bu izinler token üretme ekranında
 * zaten listelenmiyor, ama listelenmeseydi bile buradan geçemezler. Bir bearer
 * token'a etkileşimli root kabuk vermenin karşılığında hiçbir kazanım yok.
 */
const TOKEN_FORBIDDEN: ReadonlySet<PermissionKey> = new Set<PermissionKey>([
  "docker.exec",
  "host.shell",
]);

/** Çözümleme sebepleri log/audit için ayrışıyor; dışarı hepsi aynı 401. */
function failureDetail(reason: ResolveFailure): string {
  switch (reason) {
    case "revoked":
      return "iptal edilmiş anahtar";
    case "expired":
      return "süresi dolmuş anahtar";
    case "inactive":
      return "pasif kullanıcı";
    case "must_change_password":
      return "parola değiştirilmeden kullanılamaz";
    default:
      return "tanınmayan anahtar";
  }
}

export async function guardV1(
  request: Request,
  permission: PermissionKey | null,
): Promise<GuardResult> {
  if (!getBool("api.enabled")) {
    // 404, 403 değil: kapalı bir API'nin var olduğunu bile söylememek gerekir.
    return { ok: false, response: apiError("not_found", "dış API kapalı") };
  }

  const ip = rateLimitIp(request);

  /*
    TAŞIMA KATMANI KONTROLÜ KALDIRILDI (M3.45).

    Burada `x-forwarded-proto` https değilse istek 403 ile reddediliyordu.
    O kuralın tek gerekçesi — kendi `https.ts` dosyasında yazılıydı — şuydu:
    "Caddyfile yanlışlıkla düz HTTP yayına açılırsa token açıkta gitmeden
    önce isteği kes." Yani bir saldırgana karşı değil, KENDİ YANLIŞ
    YAPILANDIRMAMIZA karşıydı ve zaten güvenlik sınırı değildi (başlığı
    istemci uydurabiliyor; uyduran "https" yazar).

    Panel M3.45'te bilinçli olarak düz HTTP'ye geçti. Kural artık yanlış
    yapılandırmayı değil, KASITLI yapılandırmayı yakalıyordu: üretimde Caddy
    `x-forwarded-proto: http` gönderdiği için /api/v1'in TAMAMI 403 dönüyordu.
    Var olmayan bir hataya karşı çalışan bir kontrol, çalışan bir API'yi
    kapatıyorsa kontrol gider.

    Paneli yeniden HTTPS'e alırsan buranın geri gelmesi gerekmez — taşıma
    güvenliği Caddy'nin sorunu ve gerçek sınır hâlâ ağ katmanında: panel
    konteyneri kendi portunu yayınlamıyor.
  */

  const authorization = request.headers.get("authorization");
  const actor = authorization
    ? resolveBearer(authorization, ip)
    : await resolveCookieSession(request, ip);

  if (!actor.ok) return actor;

  if (permission !== null && !actor.actor.permissions.includes(permission)) {
    return { ok: false, response: apiError("forbidden", "bu işlem için yetkiniz yok") };
  }

  return actor;
}

function resolveBearer(header: string, ip: string): GuardResult {
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  if (!match) {
    return { ok: false, response: unauthorizedAfterFailure(ip, "biçimsiz Authorization başlığı") };
  }

  const resolved = resolveApiToken(match[1].trim());
  if (!resolved.ok) {
    return { ok: false, response: unauthorizedAfterFailure(ip, failureDetail(resolved.reason)) };
  }

  /*
   * BAŞARILI ÇÖZÜMLEME SAYACI SIFIRLAMAZ — burada bilerek bir şey YAPILMIYOR.
   *
   * Önceki hâlinde `authLimiter.reset(ip)` çağrılıyordu; gerekçesi "tek IP
   * arkasındaki meşru trafik başkasının denemeleri yüzünden cezalandırılmasın"
   * idi. Gerekçe geçersiz: kimlik denemesi kovası YALNIZCA başarısız yolda
   * (`unauthorizedAfterFailure`) okunuyor, dolayısıyla geçerli bir token bu
   * kovadan zaten hiç etkilenmiyor. Korunacak bir şey yoktu.
   *
   * Sıfırlamanın tek gerçek etkisi kovayı ATLATILABİLİR kılmaktı: elinde bir
   * geçerli anahtar olan biri, her 10 tahminin arasına tek bir geçerli istek
   * sıkıştırarak sayacı sonsuza kadar sıfırlayabiliyordu. Ölçüldü —
   * geçersiz denemelerle 429'a ulaşıldıktan sonra tek bir geçerli istek
   * kovayı boşaltıyor ve sonraki tahmin yeniden 401 alıyordu.
   *
   * Kovanın kalıcı olması meşru istemciyi etkilemiyor (o hiç bakılmıyor),
   * tarama yapanı ise gerçekten yavaşlatıyor. Sınır varmış gibi görünüp
   * hiçbir şey sınırlamayan bir kod, sınırın hiç olmamasından kötüdür.
   */

  const { identity } = resolved;
  const usage = usageLimiter.hit(String(identity.tokenId), getNumber("api.rate_limit_per_minute"));
  if (!usage.allowed) return { ok: false, response: rateLimited(usage.retryAfter) };

  touchApiToken(identity.tokenId, ip);

  return {
    ok: true,
    actor: {
      userId: identity.userId,
      username: identity.username,
      permissions: identity.permissions.filter((key) => !TOKEN_FORBIDDEN.has(key)),
      via: "token",
      tokenId: identity.tokenId,
      tokenName: identity.tokenName,
      tokenPrefix: identity.prefix,
      ip,
    },
  };
}

function unauthorizedAfterFailure(ip: string, detail: string): Response {
  const attempt = authLimiter.hit(ip, getNumber("api.auth_rate_limit_per_minute"));
  if (!attempt.allowed) return rateLimited(attempt.retryAfter);

  console.warn(`[apiv1] kimlik doğrulanamadı (${ip}): ${detail}`);
  // Sebep DIŞARI VERİLMİYOR: "bu anahtar iptal edilmiş" ile "böyle bir anahtar
  // yok" arasındaki fark, tarama yapan birine bilgi olurdu.
  return apiError("unauthorized", "geçerli bir API anahtarı gerekli");
}

async function resolveCookieSession(request: Request, ip: string): Promise<GuardResult> {
  const session = await currentSession();
  if (!session) {
    return { ok: false, response: apiError("unauthorized", "geçerli bir API anahtarı gerekli") };
  }

  // Çerez yolunda CSRF hâlâ zorunlu — bearer'daki muafiyet çerez
  // gönderilmediği için geçerliydi, burada çerez var.
  if (!SAFE_METHODS.has(request.method)) {
    const header = request.headers.get(CSRF_HEADER) ?? "";
    if (!header || !safeEquals(header, session.csrfToken)) {
      return { ok: false, response: apiError("forbidden", "CSRF doğrulaması başarısız") };
    }
  }

  return {
    ok: true,
    actor: {
      userId: session.user.id,
      username: session.user.username,
      permissions: session.user.permissions,
      via: "session",
      ip,
    },
  };
}
