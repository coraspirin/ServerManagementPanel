/**
 * M3.6 — SQL güvenlik süzgeci.
 *
 * İki ayrı soru soruyor:
 *   1. Bu ifade YAZIYOR mu? (salt-okunur bağlantıda reddedilir)
 *   2. Bu ifade TEHLİKELİ mi? (ek onay ister)
 *
 * Gerçek bir SQL ayrıştırıcı değil ve olduğunu iddia etmiyor. Amacı kötü
 * niyetli birini durdurmak DEĞİL — zaten `db.write` izni olan biri niyet
 * ederse yazar. Amacı KAZAYI durdurmak: WHERE'siz bir DELETE'i, yanlış
 * pencerede çalıştırılan bir DROP'u.
 *
 * Bu yüzden yorumlar ve dizeler temizlendikten sonra bakılıyor: bir sütun
 * adında geçen "delete" kelimesi ifadeyi tehlikeli yapmamalı.
 */

export type SqlKind = "read" | "write" | "schema" | "unknown";

export type SqlAnalysis = {
  kind: SqlKind;
  /** Ek onay gerektiren sebepler; boşsa onay istenmiyor. */
  dangers: string[];
  /** Birden çok ifade var mı — tek seferde bir ifade çalıştırılıyor. */
  statementCount: number;
};

/** Yorumları ve dize sabitlerini boşlukla değiştirir. */
function strip(sql: string): string {
  let out = "";
  let index = 0;

  while (index < sql.length) {
    const two = sql.slice(index, index + 2);

    if (two === "--") {
      const end = sql.indexOf("\n", index);
      index = end < 0 ? sql.length : end;
      continue;
    }
    if (two === "/*") {
      const end = sql.indexOf("*/", index + 2);
      index = end < 0 ? sql.length : end + 2;
      out += " ";
      continue;
    }

    const char = sql[index];
    if (char === "'" || char === '"' || char === "`") {
      index += 1;
      while (index < sql.length) {
        if (sql[index] === char) {
          // Kaçırılmış tırnak ('' ya da ""): dize sürüyor demektir.
          if (sql[index + 1] === char) index += 2;
          else break;
        } else index += 1;
      }
      index += 1;
      out += " ";
      continue;
    }

    out += char;
    index += 1;
  }

  return out;
}

const READ_STARTS = ["select", "with", "show", "explain", "describe", "desc", "pragma", "values", "table"];
const WRITE_STARTS = ["insert", "update", "delete", "replace", "merge", "upsert"];
const SCHEMA_STARTS = ["create", "drop", "alter", "truncate", "rename", "grant", "revoke", "vacuum", "reindex", "attach", "detach"];

export function analyzeSql(sql: string): SqlAnalysis {
  const clean = strip(sql).trim();
  const statements = clean
    .split(";")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  const first = (statements[0] ?? "").toLowerCase();
  const word = first.split(/\s+/)[0] ?? "";

  let kind: SqlKind = "unknown";
  if (READ_STARTS.includes(word)) kind = "read";
  else if (WRITE_STARTS.includes(word)) kind = "write";
  else if (SCHEMA_STARTS.includes(word)) kind = "schema";

  // `WITH ... DELETE` gibi yazan CTE'ler okuma gibi başlıyor.
  if (kind === "read" && word === "with" && /\b(insert|update|delete)\b/.test(first)) {
    kind = "write";
  }

  const dangers: string[] = [];

  if (/\bdrop\s+(table|database|schema|index|view)\b/.test(first)) {
    dangers.push("DROP — nesne kalıcı olarak silinir");
  }
  if (/\btruncate\b/.test(first)) {
    dangers.push("TRUNCATE — tablodaki tüm satırlar silinir");
  }
  if (/^delete\b/.test(first) && !/\bwhere\b/.test(first)) {
    dangers.push("WHERE'siz DELETE — tablodaki TÜM satırlar silinir");
  }
  if (/^update\b/.test(first) && !/\bwhere\b/.test(first)) {
    dangers.push("WHERE'siz UPDATE — tablodaki TÜM satırlar değişir");
  }
  if (/\bgrant\b|\brevoke\b/.test(first)) {
    dangers.push("Yetki değişikliği");
  }

  return { kind, dangers, statementCount: statements.length };
}

/** SELECT'e otomatik LIMIT ekler (yoksa). Kazayla açılan devasa sorgu için. */
export function applyLimit(sql: string, engine: string, limit: number): string {
  const clean = strip(sql).trim().toLowerCase();
  if (!clean.startsWith("select") && !clean.startsWith("with")) return sql;
  if (/\blimit\s+\d/.test(clean)) return sql;
  if (engine === "redis") return sql;

  const trimmed = sql.trim().replace(/;\s*$/, "");
  return `${trimmed} LIMIT ${limit}`;
}
