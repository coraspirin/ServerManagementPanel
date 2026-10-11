/**
 * İstemci IP'si. Gerçek IP, container giriş noktasındaki ön katmanın
 * (`scripts/docker-entry.mjs`, `startFront`) eklediği başlıklardan gelir.
 *
 * Not: bu başlıklara yalnızca Next doğrudan dışarıya açık OLMADIĞI için
 * güvenilebilir — Next 127.0.0.1'de dinliyor, ön katman istemcinin gönderdiği
 * değerleri silip soket adresini yazıyor. Next başka bir yoldan açılırsa
 * istemci bu başlıkları uydurabilir.
 */
export function clientIp(request: Request): string {
  const realIp = request.headers.get("x-real-ip");
  if (realIp) return realIp.trim();

  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();

  return "";
}
