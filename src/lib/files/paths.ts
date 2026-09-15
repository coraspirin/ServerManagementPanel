import "server-only";

import path from "node:path";
import { getString } from "@/lib/settings";

/**
 * M3.5 — dosya yöneticisinin yol güvenliği.
 *
 * TEK GİRİŞ NOKTASI: host üzerindeki her yol buradan geçer. Doğrulama tek bir
 * yerde toplandı çünkü dağıtılmış bir kontrol listesinde bir uç noktayı atlamak
 * "panelden tüm dosya sistemi okunabiliyor" demek olurdu.
 *
 * Host kökü container'a `/host/root` altında SALT-OKUNUR bağlı (M1.10). Okuma
 * doğrudan oradan yapılır; yazma işlemleri geçici bir container üzerinden
 * gider (bkz. files/write.ts) çünkü panelin kendisinin host'a yazma yetkisi
 * yok — ve olmaması iyi.
 */

const HOST_ROOT = process.env.HOST_ROOT ?? "/host/root";

/**
 * Hiçbir koşulda erişilmeyen yollar.
 *
 * `/proc` ve `/sys` çekirdek arayüzü: bazı dosyalarına okumak bile bloke eder
 * ya da yan etki yaratır. `/dev` blok cihazlar — bir disk imajını HTTP ile
 * indirmeye çalışmak paneli kilitler.
 */
const NEVER = ["/proc", "/sys", "/dev", "/run"];

/**
 * `NEVER` listesine düşüyor mu.
 *
 * Dışa açık çünkü dizin SEÇİCİ (M3.45) `checkPath`ten geçemiyor: seçicinin
 * yapılandırdığı ayarın kendisi izinli kök listesi ve gezinme o listeyle
 * sınırlanamaz. Kök kontrolü düşse de çekirdek arayüzü yasağı düşmemeli.
 */
export function forbiddenPath(hostPath: string): boolean {
  return NEVER.some((entry) => hostPath === entry || hostPath.startsWith(`${entry}/`));
}

/**
 * İÇERİĞİ hiçbir zaman okunmayan dosyalar.
 *
 * Listede görünmelerinde sakınca yok (varlıkları zaten sır değil) ama içerik
 * okuma yükseltilmiş yetkiyle çalıştığı için `/etc/shadow` gibi bir dosya
 * panelden okunabilir hâle gelirdi. Dosya yöneticisinin işi sistem sırlarını
 * göstermek değil.
 */
const SENSITIVE = [
  /^\/etc\/shadow-?$/,
  /^\/etc\/gshadow-?$/,
  /^\/etc\/sudoers(\.d\/.*)?$/,
  /^\/etc\/ssh\/ssh_host_.*_key$/,
  /(^|\/)id_(rsa|dsa|ecdsa|ed25519)$/,
  /(^|\/)\.env(\..+)?$/,
  /(^|\/)\.ssh\/.*_key$/,
  /(^|\/)\.git-credentials$/,
];

/** İçeriği okunabilir mi (listeleme her zaman serbest). */
export function contentReadable(hostPath: string): boolean {
  return !SENSITIVE.some((pattern) => pattern.test(hostPath));
}

export type PathCheck =
  | { ok: true; hostPath: string; containerPath: string }
  | { ok: false; error: string };

/** Ayardaki izinli kök listesi. Boşsa dosya yöneticisi kapalı sayılır. */
export function allowedRoots(): string[] {
  return getString("files.roots")
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.startsWith("/"))
    .map((entry) => (entry.length > 1 ? entry.replace(/\/+$/, "") : entry));
}

/**
 * Kullanıcıdan gelen host yolunu doğrular ve container içindeki karşılığını
 * döndürür.
 *
 * `path.posix.normalize` ile `..` çözülüyor ve SONRA kök kontrolü yapılıyor;
 * tersi sırada `/home/../etc/shadow` kontrolü geçerdi.
 */
export function checkPath(raw: string): PathCheck {
  const input = (raw || "/").trim();
  if (!input.startsWith("/")) {
    return { ok: false, error: "Yol mutlak olmalı (/ ile başlamalı)." };
  }
  if (input.includes("\0")) {
    return { ok: false, error: "Yol geçersiz karakter içeriyor." };
  }

  const hostPath = path.posix.normalize(input).replace(/\/+$/, "") || "/";

  for (const forbidden of NEVER) {
    if (hostPath === forbidden || hostPath.startsWith(`${forbidden}/`)) {
      return { ok: false, error: `Bu yola erişilemez: ${forbidden}` };
    }
  }

  const roots = allowedRoots();
  if (roots.length === 0) {
    return {
      ok: false,
      error:
        "Dosya yöneticisi kapalı: Ayarlar → Dosyalar altında hiçbir kök dizin tanımlı değil.",
    };
  }

  const inside = roots.some(
    (root) => hostPath === root || hostPath.startsWith(root === "/" ? "/" : `${root}/`),
  );
  if (!inside) {
    return {
      ok: false,
      error: `Bu yol izinli kökler dışında. İzinliler: ${roots.join(", ")}`,
    };
  }

  return { ok: true, hostPath, containerPath: path.posix.join(HOST_ROOT, hostPath) };
}

/** Container içindeki yolu host yoluna geri çevirir (listeleme çıktısı için). */
export function toHostPath(containerPath: string): string {
  return containerPath.startsWith(HOST_ROOT)
    ? containerPath.slice(HOST_ROOT.length) || "/"
    : containerPath;
}

export function hostRoot(): string {
  return HOST_ROOT;
}
