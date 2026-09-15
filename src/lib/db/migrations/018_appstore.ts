import type { Migration } from "./types";

/**
 * M3.10 — şablondan kurulan yığınlar.
 *
 * Kurulum yalnızca dosya yazıp `compose up` çağırıyor; asıl gerçek diskteki
 * compose dosyası ve çalışan container'lar. Bu tablo o gerçeği KOPYALAMIYOR,
 * yalnızca panelin bilmediği iki şeyi tutuyor: hangi şablondan geldiği ve
 * hangi değerlerle kurulduğu. Container listesi her zaman Docker'dan okunuyor.
 *
 * Parola benzeri değişkenler saklanmıyor: compose dosyasında zaten düz metin
 * duruyorlar ve panelin ikinci bir kopya tutması, sızıntı yüzeyini
 * çoğaltmaktan başka bir işe yaramazdı.
 */
export const migration018: Migration = {
  version: 18,
  name: "appstore",
  up: `
CREATE TABLE app_stacks (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  name         TEXT    NOT NULL UNIQUE,
  template_id  TEXT    NOT NULL,
  directory    TEXT    NOT NULL,
  -- Gizli olmayan değişkenler (JSON). Parolalar burada YOK.
  variables    TEXT    NOT NULL DEFAULT '{}',
  installed_by TEXT    NOT NULL DEFAULT '',
  installed_at INTEGER NOT NULL DEFAULT (unixepoch()),
  last_action  TEXT    NOT NULL DEFAULT '',
  last_error   TEXT    NOT NULL DEFAULT ''
);
`,
};
