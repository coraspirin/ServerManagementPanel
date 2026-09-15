/**
 * İstemci IP'si. Panel Caddy arkasında çalışıyor; gerçek IP proxy'nin
 * eklediği başlıklardan gelir (Caddyfile'da X-Real-IP set ediliyor).
 *
 * Not: bu başlıklara yalnızca panel doğrudan dışarıya açık OLMADIĞI için
 * güvenilebilir — compose'da panel container'ı port yayınlamıyor, tek giriş
 * Caddy. Panel doğrudan açılırsa istemci bu başlıkları uydurabilir.
 */
export function clientIp(request: Request): string {
  const realIp = request.headers.get("x-real-ip");
  if (realIp) return realIp.trim();

  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();

  return "";
}
