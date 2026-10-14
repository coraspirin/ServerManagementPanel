import type { Migration } from "./types";

/**
 * Ajan duyurusu (Faz B adım 6, kararlar.md "Kurulum tek komut").
 *
 * `token_issued_at`: sırrın üretildiği an. Duyuru yalnız bu andan sonraki
 * kısa pencerede (ANNOUNCE_WINDOW_SECONDS) kabul edilir — sızmış eski bir
 * sırla "yeni sunucu bulundu" kaydı üretilemesin. Mevcut satırlarda NULL:
 * duyuru için sır yenilenmeli (elle kayıt her zaman çalışır).
 *
 * `announce`: ajanın kendini duyurduğu bilgi (JSON: adres, port, parmak izi,
 * sürüm, hostname). Kullanıcı onaylayınca mevcut enroll akışı çalışır ve
 * alan temizlenir.
 */
export const migration036: Migration = {
  version: 36,
  name: "agent_announce",
  up: `
ALTER TABLE hosts ADD COLUMN token_issued_at INTEGER;
ALTER TABLE hosts ADD COLUMN announce TEXT;
`,
};
