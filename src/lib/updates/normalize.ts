/**
 * Önbellekteki güncelleme satırlarının güncel şemaya tamamlanması (M3.35).
 *
 * ## Neden var — yaşanmış bir çökme
 *
 * Güncelleme kontrolünün sonucu diske yazılıyor ve günde bir yenileniyor.
 * Yani panelin YENİ sürümü, ESKİ sürümün yazdığı satırları okuyor.
 *
 * M3.27 `updatable`/`skipReason`, M3.29 `newerTag` alanlarını ekledi. Bakım
 * ekranı `newerTag !== null` diye süzüyordu — ama eski satırlarda alan hiç
 * yoktu ve `undefined !== null` DOĞRU. Satırlar süzgeci geçti, `newerTag.tag`
 * okunmaya çalışıldı ve sayfa komple çöktü:
 *
 *     TypeError: Cannot read properties of undefined (reading 'tag')
 *
 * ## Ders
 *
 * Şemaya alan eklemek geriye dönük uyumlu DEĞİL — önbellek diskte, eski
 * biçimiyle duruyor. Düzeltmenin yeri de bu yüzden ekran değil: önbelleği
 * okuyan HER tüketici (bakım ekranı, alarm koşulları) aynı korumayı almalı.
 *
 * Kullanıcı, kontrol yeniden çalışana kadar geçen sürede bir çökme değil,
 * eski ama tutarlı bir tablo görmeli.
 *
 * I/O yok, `@/` yolu yok — `node --test` altında doğrudan çalışsın diye saf.
 */

/** Şemanın yalnızca sonradan eklenen alanları; gerisine dokunulmuyor. */
export type NormalizableUpdate = {
  updatable?: boolean | null;
  skipReason?: string | null;
  newerTag?: { tag: string; bump: string } | null;
};

/**
 * Eksik alanları güvenli varsayılanlarla doldurur.
 *
 * `updatable` varsayılanı **`true`**: M3.27 öncesinde her image
 * güncellenebilirdi ve eski bir satırı "güncellenemez" saymak, kullanıcıya
 * var olmayan bir kısıt göstermek olurdu. Panelin kendini güncellememesi
 * zaten `updateContainerImage` içindeki koda gömülü kilitle sağlanıyor —
 * buradaki değer yalnızca LİSTEDE nasıl göründüğünü belirliyor.
 */
export function normalizeUpdate<T extends NormalizableUpdate>(
  row: T,
): T & { updatable: boolean; skipReason: string | null; newerTag: { tag: string; bump: string } | null } {
  return {
    ...row,
    updatable: row.updatable ?? true,
    skipReason: row.skipReason ?? null,
    newerTag: row.newerTag ?? null,
  };
}
