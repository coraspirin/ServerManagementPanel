import "server-only";
import { serverT } from "@/lib/i18n/runtime";

import { getDb } from "@/lib/db/client";
import { appVersion } from "@/lib/env";
import { findSetting } from "@/settings.schema";

/**
 * M2.13 — yapılandırma dışa/içe aktarımı.
 *
 * Kapsam KASITLI olarak dar: panelin "nasıl kurulduğu" taşınıyor, ne ürettiği
 * değil. Metrikler, uptime geçmişi, olaylar ve audit kaydı DIŞARIDA — onlar
 * bu sunucunun tarihi ve başka bir kuruluma taşınmalarının anlamı yok.
 *
 * ⚠️ SECRET'LAR DIŞARIDA. Şifreli değerler MASTER_KEY'e bağlı ve o anahtar
 *    bilerek yedeğe girmiyor (T3); şifreli blob'u taşımak, hedefte çözülemeyen
 *    bir veri taşımak olurdu. Dosya bu yüzden düz metin olarak paylaşılabilir
 *    ve içe aktarımdan sonra token'lar yeniden girilir.
 */

const FORMAT = 1;

export type ConfigExport = {
  format: number;
  exportedAt: number;
  appVersion: string;
  settings: { key: string; value: string }[];
  categories: unknown[];
  apps: unknown[];
  bookmarks: unknown[];
  monitors: unknown[];
  maintenanceWindows: unknown[];
  proxyHosts: unknown[];
  wolDevices: unknown[];
  /** Dışarıda bırakılanlar — dosyayı açan kişi ne olmadığını da bilsin. */
  excluded: string[];
};

/** Ayarın gizli olup olmadığı ŞEMADAN geliyor; elle liste tutmak unutmaya açık. */
function isSecret(key: string): boolean {
  return findSetting(key)?.type === "secret";
}

export function exportConfig(): ConfigExport {
  const db = getDb();

  const settings = (
    db
      .prepare(
        "SELECT key, value FROM settings WHERE scope_type = 'global' AND value IS NOT NULL",
      )
      .all() as { key: string; value: string }[]
  ).filter((row) => !isSecret(row.key));

  return {
    format: FORMAT,
    exportedAt: Math.floor(Date.now() / 1000),
    appVersion: appVersion(),
    settings,
    categories: db.prepare("SELECT * FROM app_categories ORDER BY sort_order").all(),
    // Widget yapılandırması şifreli; sütun dışarıda bırakılıyor.
    apps: db
      .prepare(
        `SELECT id, category_id, name, description, url, internal_url, icon, color,
                container_name, source, widget_type, open_new_tab, enabled, sort_order
         FROM apps ORDER BY sort_order`,
      )
      .all(),
    bookmarks: db.prepare("SELECT * FROM bookmarks ORDER BY group_name, sort_order").all(),
    monitors: db
      .prepare(
        `SELECT name, type, target, expected, enabled, ignore_tls,
                interval_seconds, timeout_seconds, retries, down_threshold, sort_order
         FROM monitors ORDER BY sort_order`,
      )
      .all(),
    maintenanceWindows: db.prepare("SELECT * FROM maintenance_windows").all(),
    proxyHosts: db
      .prepare(
        "SELECT domain, target_kind, target, port, tls, websocket, enabled FROM proxy_hosts",
      )
      .all(),
    wolDevices: db
      .prepare("SELECT name, mac, broadcast, port, check_host FROM wol_devices")
      .all(),
    excluded: [
      serverT("configLib.excluded.secrets"),
      serverT("configLib.excluded.tokens"),
      serverT("configLib.excluded.history"),
      serverT("configLib.excluded.users"),
      serverT("configLib.excluded.logos"),
    ],
  };
}

export type ImportResult = {
  applied: Record<string, number>;
  skipped: string[];
};

/**
 * İçe aktarım.
 *
 * **Birleştirir, silmez.** Aynı ada/anahtara sahip kayıt varsa üzerine yazar,
 * olmayanı ekler, dosyada olmayan hiçbir şeye dokunmaz. Sebebi: bu dosya çoğu
 * zaman bir yedekten değil BAŞKA bir kurulumdan geliyor ve "içe aktardım,
 * her şeyim silindi" geri alınamaz bir hata olurdu.
 *
 * Tamamı tek işlemde: yarım uygulanmış bir yapılandırma, hiç uygulanmamış
 * olmasından daha kötü.
 */
export function importConfig(
  data: ConfigExport,
  updatedBy: string,
): { ok: true; result: ImportResult } | { ok: false; error: string } {
  if (data.format !== FORMAT) {
    return { ok: false, error: serverT("configLib.unsupportedFormat", { format: String(data.format) }) };
  }

  const db = getDb();
  const applied: Record<string, number> = {};
  const skipped: string[] = [];

  db.exec("BEGIN IMMEDIATE");
  try {
    let count = 0;
    for (const row of data.settings ?? []) {
      const def = findSetting(row.key);
      // Tanımsız ayar atlanıyor: eski bir sürümden gelen dosya, artık var
      // olmayan anahtarlar taşıyabilir ve bunlar sessizce yazılmamalı.
      if (!def || def.type === "secret") {
        skipped.push(`ayar: ${row.key}`);
        continue;
      }
      db.prepare(
        `INSERT INTO settings (key, scope_type, scope_id, value, updated_at, updated_by)
         VALUES (?, 'global', '', ?, unixepoch(), ?)
         ON CONFLICT(key, scope_type, scope_id) DO UPDATE SET
           value = excluded.value, value_encrypted = NULL, iv = NULL, auth_tag = NULL,
           updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
      ).run(row.key, row.value, updatedBy);
      count++;
    }
    applied.settings = count;

    applied.categories = upsert(
      data.categories,
      "app_categories",
      ["name", "icon", "sort_order"],
      "name",
    );
    applied.apps = upsert(
      data.apps,
      "apps",
      [
        "name",
        "description",
        "url",
        "internal_url",
        "icon",
        "color",
        "container_name",
        "source",
        "widget_type",
        "open_new_tab",
        "enabled",
        "sort_order",
      ],
      "name",
    );
    applied.bookmarks = upsert(
      data.bookmarks,
      "bookmarks",
      ["group_name", "title", "url", "sort_order"],
      "title",
    );
    applied.monitors = upsert(
      data.monitors,
      "monitors",
      [
        "name",
        "type",
        "target",
        "expected",
        "enabled",
        "ignore_tls",
        "interval_seconds",
        "timeout_seconds",
        "retries",
        "down_threshold",
        "sort_order",
      ],
      "name",
    );
    applied.proxyHosts = upsert(
      data.proxyHosts,
      "proxy_hosts",
      ["domain", "target_kind", "target", "port", "tls", "websocket", "enabled"],
      "domain",
    );
    applied.wolDevices = upsert(
      data.wolDevices,
      "wol_devices",
      ["name", "mac", "broadcast", "port", "check_host"],
      "mac",
    );

    db.exec("COMMIT");
    return { ok: true, result: { applied, skipped } };
  } catch (error) {
    db.exec("ROLLBACK");
    return {
      ok: false,
      error: `İçe aktarım başarısız, hiçbir şey değişmedi: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }
}

/**
 * Ada göre birleştirme.
 *
 * `id` KULLANILMIYOR: kaynak kurulumdaki id'ler hedefte başka kayıtlara ait
 * olabilir ve id ile eşleştirmek yanlış satırın üzerine yazmak demektir.
 */
function upsert(
  rows: unknown[] | undefined,
  table: string,
  columns: string[],
  matchColumn: string,
): number {
  if (!Array.isArray(rows)) return 0;

  const db = getDb();
  let count = 0;

  for (const entry of rows) {
    const row = entry as Record<string, unknown>;
    const key = row[matchColumn];
    // Eşleştirme sütunu metin ya da sayı olmalı; nesne/dizi gelen bir dosya
    // bozuktur ve o satır atlanır.
    if (typeof key !== "string" && typeof key !== "number") continue;

    const existing = db
      .prepare(`SELECT id FROM ${table} WHERE ${matchColumn} = ?`)
      .get(key) as { id: number } | undefined;

    const values = columns.map((column) => (row[column] ?? null) as string | number | null);

    if (existing) {
      db.prepare(
        `UPDATE ${table} SET ${columns.map((c) => `${c} = ?`).join(", ")} WHERE id = ?`,
      ).run(...values, existing.id);
    } else {
      db.prepare(
        `INSERT INTO ${table} (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`,
      ).run(...values);
    }
    count++;
  }

  return count;
}
