/**
 * Güncellemede env ve label devralma (M3.28).
 *
 * ## Düzeltilen hata
 *
 * `updateContainerImage` yeni container'ı `{ ...raw.Config }` ile yaratıyordu;
 * yani eski container'ın `Env` ve `Labels`'ını olduğu gibi taşıyordu. Sonuç:
 * **imajın kendi varsayılanları da eski sürümde donuyordu.** Yeni imaj
 * `APP_VERSION=2.0` ya da `org.opencontainers.image.version` getirse bile
 * container güncellendikten sonra eskisini göstermeye devam ediyordu.
 *
 * Kullanıcının elle verdiği değerlerin korunması doğru; imajın
 * varsayılanlarının korunması hata.
 *
 * ## Kural
 *
 * | Durum | Sonuç |
 * |---|---|
 * | Değer eski **imajın** varsayılanıyla aynı | düşürülür — yeni imaj kendi değerini versin |
 * | Değer imajın varsayılanından farklı | korunur — kullanıcının override'ı |
 * | Yalnızca kullanıcının eklediği anahtar | korunur |
 * | Yalnızca yeni imajın getirdiği anahtar | imajdan gelir, karışılmaz |
 *
 * Docker `Env` verilmeyen anahtarları imajın kendi yapılandırmasından
 * dolduruyor; bu yüzden "düşürmek" değeri silmek değil, **imaja bırakmak**.
 *
 * I/O yok, `@/` yolu yok — `node --test` altında doğrudan çalışsın diye saf.
 */

/** `KEY=değer` → `[KEY, değer]`. Değerde `=` olabilir, yalnızca İLKİ ayırır. */
function split(entry: string): [string, string] {
  const index = entry.indexOf("=");
  return index === -1 ? [entry, ""] : [entry.slice(0, index), entry.slice(index + 1)];
}

/**
 * Yeni container'a taşınacak env listesi.
 *
 * @param containerEnv Eski container'ın `Config.Env` listesi.
 * @param imageEnv     Eski **imajın** `Config.Env` listesi.
 */
export function inheritEnv(
  containerEnv: string[] | null | undefined,
  imageEnv: string[] | null | undefined,
): string[] {
  const imaj = new Map((imageEnv ?? []).map(split));

  return (containerEnv ?? []).filter((entry) => {
    const [key, value] = split(entry);
    // İmajda aynı anahtar aynı değerle varsa bu satır kullanıcının değil
    // imajın; taşımak onu eski sürümde dondurmak olur.
    return !(imaj.has(key) && imaj.get(key) === value);
  });
}

/**
 * Yeni container'a taşınacak label'lar.
 *
 * Env ile aynı kural, ama iki fark var:
 *
 * 1. `com.docker.compose.*` etiketleri KORUNUYOR — imajdan gelmiyorlar,
 *    compose'un container'a yazdığı kimlik bilgileri ve kaybolurlarsa panel
 *    container'ın hangi yığına ait olduğunu bilemez.
 * 2. `org.opencontainers.image.*` etiketleri imajdan gelir ve sürüm bilgisi
 *    taşır; kural gereği düşerler ve yeni imajınki geçerli olur — zaten
 *    düzeltmenin asıl amacı bu.
 */
export function inheritLabels(
  containerLabels: Record<string, string> | null | undefined,
  imageLabels: Record<string, string> | null | undefined,
): Record<string, string> {
  const imaj = imageLabels ?? {};
  const out: Record<string, string> = {};

  for (const [key, value] of Object.entries(containerLabels ?? {})) {
    if (key.startsWith("com.docker.compose.")) {
      out[key] = value;
      continue;
    }
    if (imaj[key] === value) continue;
    out[key] = value;
  }

  return out;
}

/** Ham image inspect çıktısından `Config.Env` ve `Config.Labels` çeker. */
export function imageConfig(raw: unknown): {
  env: string[];
  labels: Record<string, string>;
} {
  const config = (raw as { Config?: { Env?: unknown; Labels?: unknown } } | null)?.Config;

  return {
    env: Array.isArray(config?.Env) ? (config.Env as unknown[]).map(String) : [],
    labels:
      config?.Labels && typeof config.Labels === "object"
        ? (config.Labels as Record<string, string>)
        : {},
  };
}
