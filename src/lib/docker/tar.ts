/**
 * Asgari tar okuyucu/yazıcı (M3.23).
 *
 * Docker'ın konteyner dosya sistemine tek erişim yolu
 * `/containers/{id}/archive` ucu ve o uç **yalnızca tar** konuşuyor: okurken
 * tar veriyor, yazarken tar bekliyor. `docker cp` de aynı şeyi yapıyor.
 *
 * Neden kütüphane değil: bu iş bir başlık ayrıştırmak ve bir başlık üretmekten
 * ibaret (~150 satır) ve panelin bağımlılık listesi bilinçli olarak kısa
 * tutuluyor — `yaml` dışında hiçbir ayrıştırıcı yok. Bir dosya kopyalamak için
 * bakım yükü olan bir paket eklemek orantısız.
 *
 * I/O yok, `@/` yolu yok: `node --test` altında doğrudan çalışsın diye saf.
 */

const BLOCK = 512;

export type TarEntry = {
  /** Arşiv içindeki yol — Docker bunu hedefe göre GÖRELİ verir. */
  name: string;
  /** Sekizlik izin biti (0o755 gibi). */
  mode: number;
  size: number;
  /** Değiştirilme zamanı, saniye. */
  mtime: number;
  /** "dosya" | "dizin" | "sembolik" | "diger" */
  type: "dosya" | "dizin" | "sembolik" | "diger";
  /** Sembolik bağın hedefi; başka türlerde boş. */
  linkName: string;
  data: Buffer;
};

/** NUL ya da boşlukla sonlanan alanı metne çevirir. */
function field(header: Buffer, offset: number, length: number): string {
  const slice = header.subarray(offset, offset + length);
  const end = slice.indexOf(0);
  return slice.subarray(0, end === -1 ? slice.length : end).toString("utf8").trim();
}

function octal(header: Buffer, offset: number, length: number): number {
  const text = field(header, offset, length);
  if (!text) return 0;
  const value = Number.parseInt(text, 8);
  return Number.isFinite(value) ? value : 0;
}

function tipi(flag: string): TarEntry["type"] {
  if (flag === "5") return "dizin";
  if (flag === "2") return "sembolik";
  if (flag === "0" || flag === "" || flag === "\0") return "dosya";
  return "diger";
}

/**
 * Tar akışını girdilere ayırır.
 *
 * GNU'nun uzun ad kaydı (`L`) ve pax başlıkları (`x`/`g`) ATLANIYOR ama uzun
 * ad, kendinden sonraki girdiye uygulanıyor: aksi hâlde 100 karakterden uzun
 * yollu dosyalar listede yanlış adla görünürdü.
 */
export function readTar(buffer: Buffer): TarEntry[] {
  const entries: TarEntry[] = [];
  let offset = 0;
  let uzunAd: string | null = null;

  while (offset + BLOCK <= buffer.length) {
    const header = buffer.subarray(offset, offset + BLOCK);

    // İki sıfır blok arşivin sonu; tek sıfır blok da bizim için son demek.
    if (header.every((byte) => byte === 0)) break;

    const size = octal(header, 124, 12);
    const flag = field(header, 156, 1);
    const prefix = field(header, 345, 155);
    const isim = field(header, 0, 100);

    const dataStart = offset + BLOCK;
    const dataEnd = dataStart + size;
    if (dataEnd > buffer.length) break;

    const data = buffer.subarray(dataStart, dataEnd);

    if (flag === "L") {
      // Sonraki girdinin adı bu bloğun içinde.
      uzunAd = data.toString("utf8").replace(/\0+$/, "");
    } else if (flag !== "x" && flag !== "g") {
      entries.push({
        name: uzunAd ?? (prefix ? `${prefix}/${isim}` : isim),
        mode: octal(header, 100, 8),
        size,
        mtime: octal(header, 136, 12),
        type: tipi(flag),
        linkName: field(header, 157, 100),
        // `subarray` görünüm döndürüyor; kopyalanmazsa çağıran, tüm arşivi
        // bellekte tutan bir buffer'a bağlı kalır.
        data: Buffer.from(data),
      });
      uzunAd = null;
    }

    offset = dataStart + Math.ceil(size / BLOCK) * BLOCK;
  }

  return entries;
}

function yaz(header: Buffer, offset: number, value: string, length: number): void {
  header.write(value.slice(0, length - 1), offset, "utf8");
}

function yazOctal(header: Buffer, offset: number, value: number, length: number): void {
  // Son bayt NUL; kalan alan sıfırla soldan doldurulur (tar geleneği).
  header.write(value.toString(8).padStart(length - 1, "0"), offset, "utf8");
}

/**
 * Tek dosyalık tar üretir.
 *
 * Docker'ın PUT ucu bir dizine açılacak arşiv bekliyor; `name` o dizine göre
 * GÖRELİ olmalı (`config.yml`, `alt/config.yml`). Mutlak yol verilirse Docker
 * onu reddediyor.
 */
export function writeTar(
  entries: { name: string; data: Buffer; mode?: number; mtime?: number }[],
): Buffer {
  const parts: Buffer[] = [];

  for (const entry of entries) {
    const header = Buffer.alloc(BLOCK);

    yaz(header, 0, entry.name, 100);
    yazOctal(header, 100, entry.mode ?? 0o644, 8);
    yazOctal(header, 108, 0, 8); // uid
    yazOctal(header, 116, 0, 8); // gid
    yazOctal(header, 124, entry.data.length, 12);
    yazOctal(header, 136, entry.mtime ?? Math.floor(Date.now() / 1000), 12);
    header.write("0", 156, "utf8"); // normal dosya
    header.write("ustar\0", 257, "utf8");
    header.write("00", 263, "utf8");

    // Sağlama, alanın kendisi BOŞLUK sayılarak hesaplanır; sıra önemli.
    header.fill(0x20, 148, 156);
    let sum = 0;
    for (const byte of header) sum += byte;
    header.write(`${sum.toString(8).padStart(6, "0")}\0 `, 148, "utf8");

    parts.push(header, entry.data);

    const padding = Math.ceil(entry.data.length / BLOCK) * BLOCK - entry.data.length;
    if (padding > 0) parts.push(Buffer.alloc(padding));
  }

  // Arşiv sonu: iki sıfır blok.
  parts.push(Buffer.alloc(BLOCK * 2));
  return Buffer.concat(parts);
}
