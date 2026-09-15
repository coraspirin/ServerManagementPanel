export type DbEngine = "sqlite" | "postgres" | "mysql" | "redis";

export type DbConnection = {
  id: number;
  name: string;
  engine: DbEngine;
  host: string;
  port: number;
  username: string;
  database: string;
  hasPassword: boolean;
  /** MASTER_KEY değiştiyse parola çözülemez. */
  passwordReadable: boolean;
  writable: boolean;
  source: "manual" | "docker";
  container: string;
  lastOkAt: number | null;
  lastError: string;
};

/** Ağaçtaki bir düğüm: veritabanı → şema → tablo. */
export type DbTable = {
  schema: string;
  name: string;
  kind: "table" | "view";
  rowCount: number | null;
  sizeBytes: number | null;
};

export type DbColumn = {
  name: string;
  type: string;
  nullable: boolean;
  defaultValue: string | null;
  primaryKey: boolean;
};

export type DbIndex = { name: string; columns: string[]; unique: boolean };

export type DbForeignKey = {
  column: string;
  referencesTable: string;
  referencesColumn: string;
};

export type DbStructure = {
  columns: DbColumn[];
  indexes: DbIndex[];
  foreignKeys: DbForeignKey[];
  createSql: string | null;
};

export type QueryResult = {
  columns: string[];
  rows: (string | number | boolean | null)[][];
  rowCount: number;
  /** INSERT/UPDATE/DELETE için etkilenen satır; SELECT'te null. */
  affected: number | null;
  durationMs: number;
  truncated: boolean;
};

export const ENGINE_LABEL: Record<DbEngine, string> = {
  sqlite: "SQLite",
  postgres: "PostgreSQL",
  mysql: "MySQL / MariaDB",
  redis: "Redis",
};

export const DEFAULT_PORT: Record<DbEngine, number> = {
  sqlite: 0,
  postgres: 5432,
  mysql: 3306,
  redis: 6379,
};
