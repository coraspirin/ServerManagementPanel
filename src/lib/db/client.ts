import "server-only";

import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import path from "node:path";

/**
 * Panelin kendi veritabanı.
 *
 * `better-sqlite3` yerine Node'un yerleşik `node:sqlite`'ı kullanılıyor:
 * native derleme gerekmediği için Windows'ta geliştirme ile Linux container
 * arasında hiçbir ayrışma olmuyor (node-gyp, prebuild, musl/glibc derdi yok).
 * Karşılığında modül Node dokümanlarında hâlâ "experimental" — bu yüzden tüm
 * DB erişimi bu modülün arkasında toplanıyor; gerekirse sürücüyü değiştirmek
 * tek dosyalık bir iş olur.
 */

let instance: DatabaseSync | null = null;

export function dataDir(): string {
  return process.env.DATA_DIR ?? path.join(process.cwd(), "data");
}

export function dbPath(): string {
  return path.join(dataDir(), "panel.db");
}

export function getDb(): DatabaseSync {
  if (instance) return instance;

  mkdirSync(dataDir(), { recursive: true });
  const db = new DatabaseSync(dbPath());

  // T5 — eşzamanlılık. WAL, okuyucuların yazıcıyı bloklamamasını sağlar;
  // panel (Next) ve worker (M0.6) aynı dosyaya erişeceği için şart.
  db.exec("PRAGMA journal_mode = WAL");
  // Yazma kilidi meşgulse hemen hata vermek yerine bekle.
  db.exec("PRAGMA busy_timeout = 5000");
  db.exec("PRAGMA foreign_keys = ON");
  // WAL ile birlikte güvenli ve belirgin şekilde daha hızlı.
  db.exec("PRAGMA synchronous = NORMAL");

  instance = db;
  return db;
}

export function closeDb(): void {
  instance?.close();
  instance = null;
}
