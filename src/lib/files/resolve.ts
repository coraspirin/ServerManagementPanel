import path from "node:path";

/**
 * Host yolundaki sembolik bağları HOST köküne göre çözer (saf; güvenlik
 * incelemesi 2026-10-14).
 *
 * Neden: yazma işlemleri üst klasörü geçici bir container'a bind eder ve
 * Docker bind kaynağındaki bağları HOST'ta çözer. İzinli kökteki
 * `bag → /etc` üzerinden `/data/bag/x` yazmak gerçekte `/etc/x`'e yazardı.
 * Panel host'u `/host/root` altında gördüğü için `realpath` kullanılamaz:
 * mutlak bir bağ (`/etc`) container'ın kendi `/etc`'ine çözülürdü. Burada
 * her parça tek tek okunur ve mutlak hedefler host köküne göre yorumlanır
 * (chroot gibi). Var olmayan parçalar olduğu gibi eklenir.
 *
 * `readLink(hostPath)`: parça sembolik bağsa hedefi, değilse (ya da yoksa)
 * null. İzin hatasını FIRLATIR — çağıran yükseltilmiş yola düşer.
 *
 * Aynı algoritma `elevated.ts` betiğinde ("resolve") — biri değişirse öteki de.
 */

const MAX_LINKS = 40;

export class LinkLoopError extends Error {}

export function resolveHostPath(hostPath: string, readLink: (hostPath: string) => string | null): string {
  let pending = hostPath.split("/").filter(Boolean);
  let resolved = "/";
  let hops = 0;
  while (pending.length > 0) {
    const part = pending.shift()!;
    if (part === ".") continue;
    if (part === "..") {
      resolved = path.posix.dirname(resolved);
      continue;
    }
    const candidate = path.posix.join(resolved, part);
    const target = readLink(candidate);
    if (target === null) {
      resolved = candidate;
      continue;
    }
    hops += 1;
    if (hops > MAX_LINKS) throw new LinkLoopError(candidate);
    pending = [...target.split("/").filter(Boolean), ...pending];
    if (target.startsWith("/")) resolved = "/";
  }
  return resolved;
}

/** `hostPath` köklerden birinin içinde mi (kök "/" her şeyi kapsar). */
export function insideRoots(hostPath: string, roots: string[]): boolean {
  return roots.some((root) => hostPath === root || hostPath.startsWith(root === "/" ? "/" : `${root}/`));
}
