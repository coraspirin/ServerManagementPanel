import path from "node:path";

/**
 * Container dizin listesinin saf ayrıştırması (M3.23).
 *
 * I/O yok, `@/` yolu yok — `node --test` altında doğrudan çalışsın diye
 * `files.ts`'ten ayrıldı (portmap.ts/ports.ts ve compose/* ile aynı ayrım).
 */

export type FileEntry = {
  name: string;
  /** Tam yol — arayüz gezinmede bunu kullanıyor. */
  path: string;
  type: "dosya" | "dizin" | "sembolik" | "diger";
  size: number;
  /** `rwxr-xr-x` — ham `ls` çıktısından, çevrilmeden. */
  permissions: string;
  owner: string;
  modified: string;
  /** Sembolik bağın hedefi; başka türlerde boş. */
  linkTarget: string;
};

/**
 * Yol normalizasyonu — `..` ile dolaşmayı ve boş yolu engeller.
 *
 * Sondaki eğik çizgi de atılıyor: `normalize` onu koruyor ve `/veri/alt/` ile
 * `/veri/alt` iki farklı dize olarak gezinme geçmişinde tekrar eder, arayüzde
 * aynı dizin iki kez görünürdü.
 */
export function normalizePath(input: string): string {
  const cleaned = path.posix.normalize(`/${input}`.replace(/\/+/g, "/"));
  if (cleaned === "." || cleaned === "") return "/";
  return cleaned.length > 1 && cleaned.endsWith("/") ? cleaned.slice(0, -1) : cleaned;
}

/**
 * `ls -la` çıktısını ayrıştırır.
 *
 * Biçim GNU coreutils ile busybox arasında ufak farklar taşıyor (sütun
 * hizalaması, tarih gösterimi). Bu yüzden sabit karakter aralığı yerine
 * "boşlukla ayrılmış ilk 8 alan, gerisi ad" kuralı kullanılıyor; ad boşluk
 * içerebiliyor ve sembolik bağlarda `ad -> hedef` biçiminde geliyor.
 */
export function parseListing(output: string, directory: string): FileEntry[] {
  const entries: FileEntry[] = [];

  for (const line of output.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    // `total 48` / busybox'ta yerelleştirilmiş karşılığı.
    if (/^(total|toplam)\s+\d+$/i.test(trimmed)) continue;

    const parts = trimmed.split(/\s+/);
    if (parts.length < 9) continue;

    const permissions = parts[0];
    // İlk karakter dosya türü; değilse bu satır bir liste satırı değil.
    if (!/^[bcdlps-]/.test(permissions)) continue;

    const size = Number.parseInt(parts[4], 10);
    const nameParts = parts.slice(8).join(" ");

    const arrow = nameParts.indexOf(" -> ");
    const name = arrow === -1 ? nameParts : nameParts.slice(0, arrow);
    const linkTarget = arrow === -1 ? "" : nameParts.slice(arrow + 4);

    if (!name || name === "." || name === "..") continue;

    entries.push({
      name,
      path: normalizePath(path.posix.join(directory, name)),
      type:
        permissions[0] === "d"
          ? "dizin"
          : permissions[0] === "l"
            ? "sembolik"
            : permissions[0] === "-"
              ? "dosya"
              : "diger",
      size: Number.isFinite(size) ? size : 0,
      permissions: permissions.slice(1),
      owner: `${parts[2]}:${parts[3]}`,
      modified: `${parts[5]} ${parts[6]} ${parts[7]}`,
      linkTarget,
    });
  }

  // Dizinler önce, sonra ada göre — dosya yöneticisi geleneği.
  return entries.sort((a, b) => {
    if ((a.type === "dizin") !== (b.type === "dizin")) return a.type === "dizin" ? -1 : 1;
    return a.name.localeCompare(b.name, "tr");
  });
}

/**
 * Yazmaya kapalı yollar.
 *
 * `/proc`, `/sys` ve `/dev` çekirdeğin sanal dosya sistemleri; oraya yazmak
 * dosya düzenlemek değil, çalışan çekirdeğe komut vermek. Gezilebilir
 * olmaları teşhis için yararlı, yazılabilir olmaları için sebep yok.
 */
export function writeBlocked(input: string): boolean {
  const target = normalizePath(input);
  return ["/proc", "/sys", "/dev"].some(
    (prefix) => target === prefix || target.startsWith(`${prefix}/`),
  );
}

/**
 * `ls` komutunun bulunamadığını anlar.
 *
 * distroless ve scratch imajlarda kabuk da `ls` de yok. Bu durumu "dizin boş"
 * gibi göstermek kullanıcıyı yanıltırdı; ayrı bir mesajla söylemek için önce
 * ayırt etmek gerekiyor.
 */
export function looksLikeMissingLs(output: string): boolean {
  return /exec.*not found|no such file or directory.*\bls\b|OCI runtime exec failed/i.test(
    output,
  );
}
