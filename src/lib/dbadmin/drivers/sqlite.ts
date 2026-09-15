import "server-only";

import { DatabaseSync } from "node:sqlite";
import { accessSync, constants } from "node:fs";
import path from "node:path";

import { panelImage } from "@/lib/host/self";
import { getDockerProvider } from "@/lib/providers";
import { hostRoot } from "@/lib/files/paths";
import type { DbStructure, DbTable, QueryResult } from "../types";

/**
 * M3.6 — SQLite sürücüsü.
 *
 * İki yol var ve seçimi DOSYA İZNİ belirliyor:
 *   - Panel dosyayı okuyabiliyorsa (ör. Home Assistant'ın 755 veritabanı)
 *     `node:sqlite` ile doğrudan açılır. Hızlı.
 *   - Okuyamıyorsa (ör. Pi-hole'un 640 veritabanları) sorgu, panelin KENDİ
 *     imajından üretilen root bir container içinde çalıştırılır. Aynı imaj
 *     olduğu için `node:sqlite` orada da var; ek bir bağımlılık yok.
 *
 * Dosya BÜYÜK olabilir (sunucuda Pi-hole FTL 485 MB). Bu yüzden dosya
 * kopyalanmıyor — sorgu dosyanın yanına gidiyor.
 */

const HOST_MOUNT = "/host/root";

function containerPath(hostPath: string): string {
  return path.posix.join(hostRoot(), hostPath);
}

function readableHere(hostPath: string): boolean {
  try {
    accessSync(containerPath(hostPath), constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * İfade satır mı döndürüyor yoksa değişiklik mi yapıyor?
 *
 * Deneme-yanılma ile ("önce .all(), hata verirse .run()") ayırmak yanlış
 * sonuç veriyordu: node:sqlite bir INSERT için .all() çağrıldığında hata
 * atmayıp boş dizi döndürebiliyor ve etkilenen satır sayısı kayboluyor.
 * Sunucuda görüldü — INSERT/UPDATE/DELETE hep "etkilenen: null" diyordu.
 */
function returnsRows(sql: string): boolean {
  const word = sql.trim().replace(/^\(+/, "").split(/\s+/)[0]?.toLowerCase() ?? "";
  if (["select", "pragma", "with", "explain", "values"].includes(word)) return true;
  // RETURNING yan tümcesi olan bir INSERT de satır döndürür.
  return /\breturning\b/i.test(sql);
}

/** Container içinde çalışan sabit script; parametreler ENV ile geçiyor. */
const SCRIPT = `
const { DatabaseSync } = require("node:sqlite");
try {
  const db = new DatabaseSync(process.env.DB_FILE, { readOnly: process.env.WRITABLE !== "1" });
  const sql = process.env.SQL;
  const rowsExpected = process.env.ROWS === "1";
  const stmt = db.prepare(sql);
  const out = rowsExpected
    ? { ok: true, rows: stmt.all(), changes: null }
    : (() => { const info = stmt.run(); return { ok: true, rows: [], changes: Number(info.changes) }; })();
  db.close();
  console.log(JSON.stringify(out));
} catch (error) {
  console.log(JSON.stringify({ ok: false, error: String(error && error.message || error) }));
}
`;

type RawResult = { rows: Record<string, unknown>[]; changes: number | null };

async function runElevated(
  hostPath: string,
  sql: string,
  writable: boolean,
): Promise<RawResult> {
  const image = await panelImage();
  if (!image) throw new Error("Panel imajı belirlenemedi; bu veritabanı okunamıyor.");

  const result = await getDockerProvider().runThrowaway({
    image,
    cmd: ["node", "-e", SCRIPT],
    // Yazma isteniyorsa dosyanın klasörü yazılabilir bağlanmalı: SQLite
    // veritabanın yanına -wal ve -shm dosyaları yazar.
    binds: [`/:${HOST_MOUNT}:${writable ? "rw" : "ro"}`],
    env: {
      DB_FILE: containerPath(hostPath),
      SQL: sql,
      WRITABLE: writable ? "1" : "0",
      ROWS: returnsRows(sql) ? "1" : "0",
    },
    namePrefix: "panel-sqlite",
    timeoutMs: 120_000,
    user: "0:0",
  });

  if (result.exitCode !== 0) {
    throw new Error(result.output.slice(0, 400) || "sorgu çalıştırılamadı");
  }

  // stdout: Node uyarilari stderr'e gidiyor, JSON burada.
  const line = (result.stdout ?? result.output)
    .split("\n")
    .map((entry) => entry.trim())
    .reverse()
    .find((entry) => entry.startsWith("{"));
  if (!line) throw new Error("sorgu çıktısı ayrıştırılamadı");

  const parsed = JSON.parse(line) as
    | { ok: true; rows: Record<string, unknown>[]; changes: number | null }
    | { ok: false; error: string };

  if (!parsed.ok) throw new Error(parsed.error);
  return { rows: parsed.rows, changes: parsed.changes };
}

function runHere(hostPath: string, sql: string, writable: boolean): RawResult {
  const db = new DatabaseSync(containerPath(hostPath), { readOnly: !writable });
  try {
    const statement = db.prepare(sql);
    if (returnsRows(sql)) {
      return { rows: statement.all() as Record<string, unknown>[], changes: null };
    }
    const info = statement.run();
    return { rows: [], changes: Number(info.changes) };
  } finally {
    db.close();
  }
}

export async function sqliteRun(
  hostPath: string,
  sql: string,
  writable: boolean,
): Promise<RawResult> {
  // Yazma her zaman container'dan: panelin host'a yazma yetkisi yok (M3.5).
  if (!writable && readableHere(hostPath)) {
    return runHere(hostPath, sql, false);
  }
  return runElevated(hostPath, sql, writable);
}

/** Ham satırları grid biçimine çevirir. Sütun sırası ilk satırdan gelir. */
export function toResult(raw: RawResult, durationMs: number, limit: number): QueryResult {
  const columns = raw.rows.length > 0 ? Object.keys(raw.rows[0]) : [];
  const truncated = raw.rows.length > limit;
  const rows = raw.rows.slice(0, limit).map((row) =>
    columns.map((column) => {
      const value = row[column];
      if (value === null || value === undefined) return null;
      if (typeof value === "bigint") return Number(value);
      if (value instanceof Uint8Array) return `<${value.length} bayt ikili>`;
      if (typeof value === "object") return JSON.stringify(value);
      return value as string | number | boolean;
    }),
  );

  return {
    columns,
    rows,
    rowCount: rows.length,
    affected: raw.changes,
    durationMs,
    truncated,
  };
}

export async function sqliteTables(hostPath: string): Promise<DbTable[]> {
  const raw = await sqliteRun(
    hostPath,
    `SELECT name, type FROM sqlite_master
     WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%'
     ORDER BY type, name`,
    false,
  );

  const names = raw.rows.map((row) => ({
    name: String(row.name),
    kind: String(row.type) === "view" ? ("view" as const) : ("table" as const),
  }));
  if (names.length === 0) return [];

  /*
    Satır sayıları TEK sorguda alınıyor. Tablo başına ayrı sorgu atmak, panelin
    dosyayı okuyamadığı durumda tablo başına AYRI BİR CONTAINER demekti:
    sunucuda Pi-hole'un 17 tablosu için 8,9 saniye sürüyordu. Tek UNION ALL
    ile bu tek bir çalıştırmaya iniyor.
  */
  const counts = new Map<string, number>();
  try {
    const union = names
      .map(
        (entry) =>
          `SELECT '${entry.name.replaceAll("'", "''")}' AS t, COUNT(*) AS n FROM "${entry.name.replaceAll(
            '"',
            '""',
          )}"`,
      )
      .join(" UNION ALL ");
    const counted = await sqliteRun(hostPath, union, false);
    for (const row of counted.rows) counts.set(String(row.t), Number(row.n));
  } catch {
    // Sayım başarısız olursa (ör. bozuk bir görünüm) tablo listesi yine
    // gösterilir, sayılar "?" olur.
  }

  return names.map((entry) => ({
    schema: "main",
    name: entry.name,
    kind: entry.kind,
    rowCount: counts.has(entry.name) ? (counts.get(entry.name) as number) : null,
    sizeBytes: null,
  }));
}

/**
 * Yapı bilgisinin tamamı TEK sorguda.
 *
 * PRAGMA'lar tablo-değerli fonksiyon biçiminde (`pragma_table_info(...)`)
 * çağrılıp `json_group_array` ile tek satıra toplanıyor. Ayrı ayrı sorulsaydı
 * (sütunlar + indeks listesi + indeks başına bir sorgu + FK'ler + CREATE)
 * dosyayı okuyamadığımız durumda bu, indeks sayısı kadar container demekti.
 */
export async function sqliteStructure(hostPath: string, table: string): Promise<DbStructure> {
  const quoted = table.replaceAll("'", "''");

  const raw = await sqliteRun(
    hostPath,
    `SELECT
       (SELECT json_group_array(json_object(
          'name', name, 'type', type, 'notnull', "notnull",
          'dflt_value', dflt_value, 'pk', pk))
        FROM pragma_table_info('${quoted}')) AS cols,
       (SELECT json_group_array(json_object(
          'name', il.name, 'uniq', il."unique",
          'cols', (SELECT json_group_array(ii.name) FROM pragma_index_info(il.name) ii)))
        FROM pragma_index_list('${quoted}') il) AS idx,
       (SELECT json_group_array(json_object(
          'col', "from", 'tbl', "table", 'ref', "to"))
        FROM pragma_foreign_key_list('${quoted}')) AS fks,
       (SELECT sql FROM sqlite_master WHERE name = '${quoted}') AS create_sql`,
    false,
  );

  const row = raw.rows[0] ?? {};
  const parse = <T>(value: unknown): T[] => {
    try {
      return JSON.parse(String(value ?? "[]")) as T[];
    } catch {
      return [];
    }
  };

  const columns = parse<{
    name: string;
    type: string;
    notnull: number;
    dflt_value: string | null;
    pk: number;
  }>(row.cols);

  const indexes = parse<{ name: string; uniq: number; cols: string[] }>(row.idx);
  const fks = parse<{ col: string; tbl: string; ref: string }>(row.fks);

  return {
    columns: columns.map((column) => ({
      name: column.name,
      type: column.type,
      nullable: Number(column.notnull) === 0,
      defaultValue: column.dflt_value === null ? null : String(column.dflt_value),
      primaryKey: Number(column.pk) > 0,
    })),
    indexes: indexes.map((index) => ({
      name: index.name,
      columns: index.cols ?? [],
      unique: Number(index.uniq) === 1,
    })),
    foreignKeys: fks.map((fk) => ({
      column: fk.col,
      referencesTable: fk.tbl,
      referencesColumn: fk.ref,
    })),
    createSql: row.create_sql ? String(row.create_sql) : null,
  };
}
