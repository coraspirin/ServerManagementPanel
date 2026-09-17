import "server-only";

import { mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import { dataDir, dbPath, getDb } from "./client";
import { migrations } from "./migrations";

/**
 * T11 — migration ve geri alma.
 *
 * Migration'lar tek yönlüdür; "down" script'i yazılmaz. Homelab ölçeğinde
 * down script'lerini doğru yazmak ve test etmek maliyeti karşılamaz. Bunun
 * yerine her migration ÖNCESİNDE veritabanının tutarlı bir kopyası alınır
 * (`VACUUM INTO`); bir şey ters giderse geri dönüş o dosyadan yapılır.
 */

const BACKUP_DIR_NAME = "backups";

/**
 * Kaç migration öncesi kopya saklanacağı.
 *
 * Sunucuda ölçüldü: veritabanı büyüdükçe her kopya 30-50 MB oluyor ve
 * 14 migration sonra `data/backups` 299 MB'a çıkmıştı — panelin tüm verisinin
 * çoğu. Bu dosyaların işi "az önceki migration'ı geri al"; üç sürüm öncesine
 * dönmek zaten şema uyuşmazlığı yüzünden çalışmaz.
 */
const KEEP_PRE_MIGRATION_BACKUPS = 3;

/** En yeni N tanesi dışındaki migration öncesi kopyaları siler. */
function prunePreMigrationBackups(dir: string): number {
  let removed = 0;
  try {
    const files = readdirSync(dir)
      .filter((name) => /^pre-migration-\d+\.db$/.test(name))
      .map((name) => ({
        name,
        version: Number(name.replace(/\D/g, "")),
      }))
      .sort((a, b) => b.version - a.version);

    for (const file of files.slice(KEEP_PRE_MIGRATION_BACKUPS)) {
      rmSync(path.join(dir, file.name), { force: true });
      removed += 1;
    }
  } catch (error) {
    // Budama başarısız olsa da migration akışı durmamalı.
    console.error("[db] eski migration yedekleri budanamadı:", error);
  }
  return removed;
}

export type MigrationResult = {
  from: number;
  to: number;
  applied: string[];
  backupPath: string | null;
};

function ensureMigrationTable(): void {
  getDb().exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version    INTEGER PRIMARY KEY,
      name       TEXT    NOT NULL,
      applied_at INTEGER NOT NULL DEFAULT (unixepoch())
    )
  `);
}

export function currentVersion(): number {
  ensureMigrationTable();
  const row = getDb()
    .prepare("SELECT COALESCE(MAX(version), 0) AS v FROM schema_migrations")
    .get() as { v: number } | undefined;
  return row?.v ?? 0;
}

/** Migration öncesi tutarlı yedek. Boş veritabanı için atlanır. */
function backupBefore(targetVersion: number): string | null {
  const db = getDb();

  // `schema_migrations` migration'lardan önce oluşturulur; onu ve SQLite'ın
  // kendi tablolarını saymazsak "gerçekten boş mu" sorusuna doğru cevap alırız.
  // Aksi halde ilk kurulumda anlamsız bir yedek dosyası üretilir.
  const userTables = (
    db
      .prepare(
        `SELECT COUNT(*) AS n FROM sqlite_master
         WHERE type = 'table'
           AND name NOT LIKE 'sqlite_%'
           AND name <> 'schema_migrations'`,
      )
      .get() as { n: number }
  ).n;
  if (userTables === 0) return null;

  const dir = path.join(dataDir(), BACKUP_DIR_NAME);
  mkdirSync(dir, { recursive: true });

  const file = path.join(dir, `pre-migration-${targetVersion}.db`);
  // VACUUM INTO var olan dosyanın ÜZERİNE YAZMAZ, hata verir. Aynı sürüme
  // ikinci kez migrate edilmez ama container yeniden yaratıldığında yarım
  // kalmış bir dosya duruyor olabilir.
  rmSync(file, { force: true });
  // VACUUM INTO, canlı veritabanından tutarlı tek dosyalık kopya üretir.
  db.prepare("VACUUM INTO ?").run(file);

  // Yeni kopya alındıktan SONRA budanıyor: budama önce yapılsaydı ve VACUUM
  // başarısız olsaydı, geri dönülecek dosya da silinmiş olurdu.
  const removed = prunePreMigrationBackups(dir);
  if (removed > 0) {
    console.log(
      `[db] ${removed} eski migration yedeği silindi (en yeni ${KEEP_PRE_MIGRATION_BACKUPS} tanesi saklanıyor)`, // i18n-ignore — operatör logu
    );
  }

  return file;
}

/** Yedek klasörünün toplam boyutu — /api/health'te gösterilir. */
export function migrationBackupBytes(): number {
  try {
    const dir = path.join(dataDir(), BACKUP_DIR_NAME);
    return readdirSync(dir)
      .filter((name) => name.endsWith(".db"))
      .reduce((total, name) => total + statSync(path.join(dir, name)).size, 0);
  } catch {
    return 0;
  }
}

/**
 * Bekleyen migration'ları uygular. Hata durumunda fırlatır — çağıran taraf
 * uygulamayı başlatmayı reddetmelidir (bozuk şemayla çalışmak daha kötüdür).
 */
export function runMigrations(): MigrationResult {
  const db = getDb();
  const from = currentVersion();

  const pending = migrations
    .filter((m) => m.version > from)
    .sort((a, b) => a.version - b.version);

  if (pending.length === 0) {
    return { from, to: from, applied: [], backupPath: null };
  }

  const backupPath = backupBefore(pending[0].version);
  const applied: string[] = [];

  for (const migration of pending) {
    db.exec("BEGIN");
    try {
      db.exec(migration.up);
      db.prepare("INSERT INTO schema_migrations (version, name) VALUES (?, ?)").run(
        migration.version,
        migration.name,
      );
      db.exec("COMMIT");
      applied.push(`${migration.version}_${migration.name}`);
    } catch (error) {
      db.exec("ROLLBACK");
      const hint = backupPath
        ? `Geri dönmek için: docker compose down && cp "${backupPath}" "${dbPath()}"` // i18n-ignore — operatör logu
        : "Veritabanı boştu, yedek alınmadı; data/panel.db silinip yeniden başlatılabilir."; // i18n-ignore — operatör logu
      throw new Error(
        `Migration ${migration.version}_${migration.name} başarısız: ` + // i18n-ignore — operatör logu
          `${error instanceof Error ? error.message : String(error)}\n${hint}`,
      );
    }
  }

  return { from, to: currentVersion(), applied, backupPath };
}
