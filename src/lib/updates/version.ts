/**
 * Etiket sürümü karşılaştırması (M3.29).
 *
 * ## Neden gerekiyor
 *
 * Güncelleme kontrolümüz digest karşılaştırıyor: `nginx:1.24` etiketinin
 * İÇERİĞİ değişirse haber veriyor. Ama `nginx:1.26` yayımlandığını göremiyor.
 *
 * Bu bir tutarsızlıktı: compose ön kontrolümüz *"sürüm etiketi
 * sabitlenmemiş"* önerisi veriyor — yani "etiketini sabitle" diyoruz, sonra
 * sabitlenen etiketin eskidiğini söyleyemiyoruz. Tavsiyemize uyanı kör
 * bırakıyorduk.
 *
 * ## Kütüphanesiz, çünkü iş dar
 *
 * SemVer (`1.2.3`) ve CalVer (`2024.12.5`) aynı kalıpla okunuyor: noktayla
 * ayrılmış sayı dizisi. Tam bir SemVer uygulaması ön sürüm önceliği ve build
 * metadata kuralları taşıyor; burada gereken tek şey "hangisi daha yeni".
 *
 * I/O yok, `@/` yolu yok — `node --test` altında doğrudan çalışsın diye saf.
 */

export type Bump = "yama" | "minor" | "major";

export type ParsedTag = {
  /** Ham etiket, olduğu gibi. */
  raw: string;
  /** [major, minor, patch, …] — eksik parçalar 0 sayılmaz, kısa kalır. */
  parts: number[];
  /**
   * Sürümden sonraki ek: `1.2-alpine` → `alpine`, `1.2` → boş.
   *
   * "Lezzet" (flavor) diyoruz: aynı uygulamanın farklı taban imajları
   * (`-alpine`, `-slim`) ya da varyantları (`-ce`, `-fpm`). Lezzet
   * değiştirmek sürüm yükseltmek değil, başka bir imaja geçmektir.
   *
   * Ön sürüm ekleri buraya GİRMİYOR: `1.5.0-rc1-alpine` → flavor `alpine`,
   * ön sürüm `["rc","1"]`. İkisini karıştırmak, rc etiketli bir imajın
   * lezzetini "rc1" sanmak ve lezzet süzgecini kırmak olurdu.
   */
  flavor: string;
  /**
   * Ön sürüm belirteçleri: `1.5.0-rc1` → `["rc", "1"]`, sürüm ise boş.
   *
   * Dizi olarak tutuluyor çünkü SemVer karşılaştırması parça parça yapılıyor
   * ve `rc1` ile `rc2`yi ayırt etmenin başka yolu yok — sayısal parçalar
   * ikisinde de aynı.
   */
  pre: string[];
  /** Kolaylık: `pre.length > 0`. */
  prerelease: boolean;
};

/** Ön sürüm sözcüğü + isteğe bağlı sayı: `rc`, `rc1`, `beta`. */
const ON_SURUM_TOKEN = /^(rc|alpha|beta|dev|nightly|preview|snapshot|next|canary)(\d*)$/i;

/**
 * Etiketi sürüm parçalarına ayırır; sürüm gibi görünmüyorsa `null`.
 *
 * `latest`, `stable`, `main` gibi hareketli etiketler bilerek reddediliyor:
 * onlarda "daha yeni sürüm" diye bir şey yok, zaten hep en yenisini
 * gösteriyorlar. Digest kontrolü onların işi.
 */
export function parseTag(tag: string): ParsedTag | null {
  const text = tag.trim();
  if (!text) return null;

  // Baştaki `v` yaygın ve anlamsız: `v1.2.3` ile `1.2.3` aynı sürüm.
  const govde = text.replace(/^v(?=\d)/i, "");

  const match = govde.match(/^(\d+(?:\.\d+)*)(.*)$/);
  if (!match) return null;

  const parts = match[1].split(".").map((piece) => Number.parseInt(piece, 10));
  if (parts.some((part) => !Number.isFinite(part))) return null;

  // Tek sayılı etiketler (`8`, `2024`) sürüm sayılıyor: `mariadb:11` gibi
  // majör-yalnız etiketler yaygın.
  const tokens = match[2].replace(/^[-._]/, "").split(/[-._]/).filter(Boolean);

  const pre: string[] = [];
  const flavorParts: string[] = [];
  let onSurumde = false;

  for (const token of tokens) {
    const eslesme = token.match(ON_SURUM_TOKEN);
    if (eslesme) {
      onSurumde = true;
      pre.push(eslesme[1].toLowerCase());
      if (eslesme[2]) pre.push(eslesme[2]);
      continue;
    }
    // Ön sürüm sözcüğünden hemen sonra gelen çıplak sayı ona aittir:
    // `2.0.0-beta.2` → ["beta", "2"].
    if (onSurumde && /^\d+$/.test(token)) {
      pre.push(token);
      continue;
    }
    onSurumde = false;
    flavorParts.push(token);
  }

  return {
    raw: tag,
    parts,
    flavor: flavorParts.join("-"),
    pre,
    prerelease: pre.length > 0,
  };
}

/**
 * Ön sürüm belirteçlerini SemVer kurallarıyla karşılaştırır.
 *
 * Kural: sayısal parçalar sayısal, diğerleri sözlük sırasıyla; sayısal olan
 * her zaman daha küçük; tüm parçalar eşitse daha AZ parçalı olan küçüktür
 * (`rc` < `rc1`).
 */
function comparePre(a: string[], b: string[]): number {
  const uzunluk = Math.max(a.length, b.length);

  for (let index = 0; index < uzunluk; index += 1) {
    const x = a[index];
    const y = b[index];
    if (x === undefined) return -1;
    if (y === undefined) return 1;

    const xSayi = /^\d+$/.test(x);
    const ySayi = /^\d+$/.test(y);

    if (xSayi && ySayi) {
      const fark = Number(x) - Number(y);
      if (fark !== 0) return fark;
      continue;
    }
    if (xSayi !== ySayi) return xSayi ? -1 : 1;

    const fark = x.localeCompare(y);
    if (fark !== 0) return fark;
  }

  return 0;
}

/** a > b ise pozitif, a < b ise negatif, eşitse 0. */
export function compareVersions(a: ParsedTag, b: ParsedTag): number {
  const uzunluk = Math.max(a.parts.length, b.parts.length);
  for (let index = 0; index < uzunluk; index += 1) {
    // Eksik parça 0 sayılıyor: `1.2` ile `1.2.0` aynı sürüm.
    const fark = (a.parts[index] ?? 0) - (b.parts[index] ?? 0);
    if (fark !== 0) return fark;
  }

  // Sayısal parçalar eşit: SÜRÜM her zaman kendi ÖN SÜRÜMÜNDEN büyüktür.
  // `1.5.0-rc1` kullanan birine `1.5.0`ın çıktığını söylemek gerekiyor ve
  // yalnızca sayılara bakan bir karşılaştırma bunu kaçırır.
  if (a.pre.length === 0 && b.pre.length === 0) return 0;
  if (a.pre.length === 0) return 1;
  if (b.pre.length === 0) return -1;

  return comparePre(a.pre, b.pre);
}

/**
 * `candidate`, `current`'a göre hangi sıçrama.
 *
 * Daha eski ya da eşitse `null`. CalVer'de "major" yıl değişimi demek oluyor
 * ve bu, kullanıcı açısından yine en büyük sıçrama — ayrı bir kategori
 * uydurmaya gerek yok.
 */
export function bumpOf(current: ParsedTag, candidate: ParsedTag): Bump | null {
  if (compareVersions(candidate, current) <= 0) return null;
  if ((candidate.parts[0] ?? 0) !== (current.parts[0] ?? 0)) return "major";
  if ((candidate.parts[1] ?? 0) !== (current.parts[1] ?? 0)) return "minor";
  // Sayısal parçalar aynı, fark yalnızca ön sürümde (`rc1` → `rc2` ya da
  // `rc2` → sürümün kendisi): en küçük sıçrama.
  return "yama";
}

const SIRA: Record<Bump, number> = { yama: 0, minor: 1, major: 2 };

export type SuggestOptions = {
  /** Bu sıçramadan büyüğü önerilmez. */
  maxBump: Bump;
  /** Açıkken yalnızca aynı lezzetteki etiketler önerilir. */
  matchFlavor: boolean;
  /** Açıkken `-rc`/`-beta` etiketleri de değerlendirilir. */
  includePrerelease: boolean;
};

export type Suggestion = { tag: string; bump: Bump };

/**
 * Kayıt defterindeki etiketler arasından en iyi öneriyi seçer.
 *
 * "En iyi" = sınırlar içindeki EN YÜKSEK sürüm. Bir adım ötesini önermek
 * (`1.4.2` → `1.4.3` varken `1.4.5` dururken) kullanıcıyı iki kez
 * güncellemeye zorlardı.
 */
export function suggestUpgrade(
  currentTag: string,
  availableTags: string[],
  options: SuggestOptions,
): Suggestion | null {
  const current = parseTag(currentTag);
  if (!current) return null;

  // Çalışan etiket bir ön sürümse, ön sürümler otomatik değerlendirmeye
  // giriyor: `1.5.0-rc1` kullanan birine `1.5.0-rc2`yi göstermemek anlamsız.
  const onSurumeIzin = options.includePrerelease || current.prerelease;

  let best: Suggestion | null = null;
  let bestParsed: ParsedTag | null = null;

  for (const tag of availableTags) {
    const aday = parseTag(tag);
    if (!aday) continue;
    if (aday.prerelease && !onSurumeIzin) continue;
    if (options.matchFlavor && aday.flavor !== current.flavor) continue;

    const bump = bumpOf(current, aday);
    if (bump === null) continue;
    if (SIRA[bump] > SIRA[options.maxBump]) continue;

    if (bestParsed === null || compareVersions(aday, bestParsed) > 0) {
      best = { tag: aday.raw, bump };
      bestParsed = aday;
    }
  }

  return best;
}
