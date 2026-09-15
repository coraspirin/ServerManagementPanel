import "server-only";

import { getDb } from "@/lib/db/client";
import type { PermissionKey } from "@/lib/auth/types";
import { findWidget, WIDGETS, type WidgetPlacement } from "./catalog";

/** M3.13 — kullanıcının gösterge paneli düzeni. */

type Row = { widget_key: string; position: number; visible: number };

/**
 * Kullanıcının etkin düzeni.
 *
 * Kaydı olmayan widget'lar şemadaki sırayla SONA ekleniyor; kaydı olan ama
 * artık katalogda bulunmayanlar atlanıyor. Böylece bir widget kaldırıldığında
 * ya da eklendiğinde eski kayıtlar bozulmuyor ve temizlik migration'ı
 * gerekmiyor.
 */
export function layoutFor(userId: number, permissions: PermissionKey[]): WidgetPlacement[] {
  const rows = getDb()
    .prepare("SELECT widget_key, position, visible FROM dashboard_widgets WHERE user_id = ?")
    .all(userId) as Row[];

  const saved = new Map(rows.map((row) => [row.widget_key, row]));

  const allowed = WIDGETS.filter(
    (widget) => !widget.permission || permissions.includes(widget.permission),
  );

  return allowed
    .map((widget, index) => {
      const row = saved.get(widget.key);
      return {
        key: widget.key,
        label: widget.label,
        description: widget.description,
        wide: widget.wide,
        visible: row ? row.visible === 1 : widget.visible,
        // Kaydı olmayan widget kataloğun sonuna değil, kataloğdaki kendi
        // sırasına göre büyük bir taban değerin üstüne yerleşiyor: sıralaması
        // korunur ama kullanıcının açıkça sıraladığı widget'ların altında kalır.
        position: row ? row.position : 1000 + index,
      };
    })
    .sort((a, b) => a.position - b.position)
    .map((entry) => ({
      key: entry.key,
      label: entry.label,
      description: entry.description,
      wide: entry.wide,
      visible: entry.visible,
    }));
}

export type LayoutInput = { key: string; visible: boolean }[];

export function validateLayout(input: LayoutInput): string | null {
  if (!Array.isArray(input)) return "Düzen listesi bekleniyordu.";
  if (input.length === 0) return "Düzen boş olamaz.";
  if (input.length > WIDGETS.length) return "Düzende tanımsız widget var.";

  const seen = new Set<string>();
  for (const entry of input) {
    if (!findWidget(entry.key)) return `Bilinmeyen widget: ${entry.key}`;
    if (seen.has(entry.key)) return `Widget iki kez geçiyor: ${entry.key}`;
    seen.add(entry.key);
  }
  return null;
}

/**
 * Düzeni kaydeder.
 *
 * Kullanıcının TÜM satırları silinip yeniden yazılıyor (kendi satırları —
 * tablo geneli değil). Tek tek güncellemek, silinen bir widget'ın satırının
 * geride kalmasına ve sıralamanın sessizce bozulmasına yol açardı.
 */
export function saveLayout(userId: number, input: LayoutInput, now: number): void {
  const db = getDb();
  // `node:sqlite` DatabaseSync'te `.transaction()` yardımcısı yok; işlem
  // sınırları elle yönetiliyor (projedeki diğer çok adımlı yazmalarla aynı).
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare("DELETE FROM dashboard_widgets WHERE user_id = ?").run(userId);
    const insert = db.prepare(
      `INSERT INTO dashboard_widgets (user_id, widget_key, position, visible, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
    );
    input.forEach((entry, index) => {
      insert.run(userId, entry.key, index, entry.visible ? 1 : 0, now);
    });
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

/** Varsayılana dönüş: sapma kaydı silinir, şema yeniden geçerli olur. */
export function resetLayout(userId: number): number {
  return Number(
    getDb().prepare("DELETE FROM dashboard_widgets WHERE user_id = ?").run(userId).changes,
  );
}
