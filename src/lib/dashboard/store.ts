import "server-only";

import { getDb } from "@/lib/db/client";
import { currentDictionary, serverT } from "@/lib/i18n/runtime";
import { translateLoose } from "@/lib/i18n/translate";
import type { PermissionKey } from "@/lib/auth/types";
import { findWidget, isWidgetSize, WIDGETS, type WidgetPlacement, type WidgetSize } from "./catalog";

/** M3.13 — kullanıcının gösterge paneli düzeni. */

type Row = { widget_key: string; position: number; visible: number; size: string | null };

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
    .prepare("SELECT widget_key, position, visible, size FROM dashboard_widgets WHERE user_id = ?")
    .all(userId) as Row[];
  return resolveLayout(rows, permissions);
}

/**
 * Kiosk bağlantısının düzeni.
 *
 * Bağlantıya özel kayıt yoksa sahibin kendi düzeni — `custom: false` bunu
 * söylüyor ki düzenleyici "sahibin düzenini izliyor" diyebilsin. Görünen
 * widget'lar her iki durumda da SAHİBİN yetkileriyle sınırlı.
 */
export function kioskLayoutFor(
  tokenHash: string,
  owner: { id: number; permissions: PermissionKey[] },
): { layout: WidgetPlacement[]; custom: boolean } {
  const rows = getDb()
    .prepare("SELECT widget_key, position, visible, size FROM kiosk_widgets WHERE token_hash = ?")
    .all(tokenHash) as Row[];
  return rows.length > 0
    ? { layout: resolveLayout(rows, owner.permissions), custom: true }
    : { layout: layoutFor(owner.id, owner.permissions), custom: false };
}

function resolveLayout(rows: Row[], permissions: PermissionKey[]): WidgetPlacement[] {
  const saved = new Map(rows.map((row) => [row.widget_key, row]));

  const allowed = WIDGETS.filter(
    (widget) => !widget.permission || permissions.includes(widget.permission),
  );

  const dict = currentDictionary();
  return allowed
    .map((widget, index) => {
      const row = saved.get(widget.key);
      return {
        key: widget.key,
        label: translateLoose(dict, `dashboard.widget.${widget.key}.label`),
        description: translateLoose(dict, `dashboard.widget.${widget.key}.description`),
        size: row && isWidgetSize(row.size) ? row.size : widget.size,
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
      size: entry.size,
      visible: entry.visible,
    }));
}

export type LayoutInput = { key: string; visible: boolean; size?: WidgetSize }[];

export function validateLayout(input: LayoutInput): string | null {
  if (!Array.isArray(input)) return serverT("dashboard.layout.expectedList");
  if (input.length === 0) return serverT("dashboard.layout.empty");
  if (input.length > WIDGETS.length) return serverT("dashboard.layout.tooMany");

  const seen = new Set<string>();
  for (const entry of input) {
    if (!findWidget(entry.key)) return serverT("dashboard.layout.unknown", { key: entry.key });
    if (seen.has(entry.key)) return serverT("dashboard.layout.duplicate", { key: entry.key });
    if (entry.size !== undefined && !isWidgetSize(entry.size)) {
      return serverT("dashboard.layout.badSize", { key: entry.key });
    }
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
  writeRows("dashboard_widgets", "user_id", userId, input, now);
}

export function saveKioskLayout(tokenHash: string, input: LayoutInput, now: number): void {
  writeRows("kiosk_widgets", "token_hash", tokenHash, input, now);
}

/** Bağlantıya özel düzeni siler: kiosk yeniden sahibinin düzenini izler. */
export function resetKioskLayout(tokenHash: string): void {
  getDb().prepare("DELETE FROM kiosk_widgets WHERE token_hash = ?").run(tokenHash);
}

/** Tablo ve sütun adları sabit — çağıranlar yalnızca yukarıdaki iki işlev. */
function writeRows(
  table: "dashboard_widgets" | "kiosk_widgets",
  owner: "user_id" | "token_hash",
  ownerValue: number | string,
  input: LayoutInput,
  now: number,
): void {
  const db = getDb();
  // `node:sqlite` DatabaseSync'te `.transaction()` yardımcısı yok; işlem
  // sınırları elle yönetiliyor (projedeki diğer çok adımlı yazmalarla aynı).
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare(`DELETE FROM ${table} WHERE ${owner} = ?`).run(ownerValue);
    const insert = db.prepare(
      `INSERT INTO ${table} (${owner}, widget_key, position, visible, size, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    input.forEach((entry, index) => {
      // Varsayılanla aynı boyut NULL yazılıyor: katalogda varsayılan
      // değişirse, boyutu hiç seçmemiş kullanıcı yenisini görsün.
      const size = entry.size && entry.size !== findWidget(entry.key)?.size ? entry.size : null;
      insert.run(ownerValue, entry.key, index, entry.visible ? 1 : 0, size, now);
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
