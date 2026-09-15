import type { Migration } from "./types";

/**
 * M1.8 — runbook notları.
 *
 * Bir container gece 3'te çöktüğünde işe yarayan şey, o container'ı kuran
 * kişinin altı ay önce öğrendiği şeydir: "bu çökerse önce şu volume'un iznine
 * bak". Bu bilgi ya kimsenin bakmadığı bir wiki'de durur ya da hiç yazılmaz.
 * Buraya yazıldığında alarm bildiriminin İÇİNDE gelir — telefona düşen mesaj
 * sorunu ve ilk adımı birlikte taşır.
 *
 * `scope_type` + `scope_id` çifti kasıtlı olarak geneldir: Faz 2'de `apps`
 * kayıtları (M2.1) ve Faz 3'te repo'lar aynı tabloyu devralacak, ayrı bir
 * "app_runbooks" tablosu açılmayacak.
 *
 * `scope_id` container İSMİDİR, id'si değil: container yeniden oluşturulunca
 * id değişir ama isim kalır. Id'ye bağlansaydı her `compose up` notu düşürürdü.
 */
export const migration007: Migration = {
  version: 7,
  name: "runbooks",
  up: `
CREATE TABLE runbooks (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  host_id    INTEGER NOT NULL DEFAULT 1 REFERENCES hosts(id) ON DELETE CASCADE,
  scope_type TEXT    NOT NULL,            -- container | app | repo
  scope_id   TEXT    NOT NULL,            -- container adı
  body       TEXT    NOT NULL,            -- markdown
  updated_at INTEGER NOT NULL,
  updated_by TEXT    NOT NULL DEFAULT '',
  UNIQUE(host_id, scope_type, scope_id)
);
`,
};
