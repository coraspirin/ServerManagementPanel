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
  source: "manual" | "docker" | "auto";
  container: string;
  /** tcp: adres + port; docker: container içinde istemci; native: host servisi. */
  transport: DbTransport;
  /** Envanterin bulduğu sunucunun anahtarı; elle eklenen bağlantıda boş. */
  instanceKey: string;
  meta: NativeMeta;
  lastOkAt: number | null;
  lastError: string;
};

export type DbTransport = "tcp" | "docker" | "native";

/** Host'a kurulu (apt/systemd) bir DB sunucusuna ulaşma bilgisi. */
export type NativeMeta = {
  /** Soket dosyası (mysql/redis) ya da dizini (postgres). */
  socket?: string;
  /** Postgres peer kimliği için host'taki `postgres` kullanıcısı. */
  uid?: number;
  gid?: number;
  /** `/etc/mysql/debian.cnf` var — root soketle olmazsa bakım hesabı. */
  debianCnf?: boolean;
  /** Servis kurulu ama soket yok: çalışmıyor. */
  stopped?: boolean;
  /** Servisin adı (systemd birimi) — arayüzde ad olarak. */
  service?: string;
};

/** Envanterde bir DB sunucusunun içindeki veritabanı. */
export type InventoryDatabase = {
  name: string;
  sizeBytes: number | null;
  /** Tablo (Redis'te anahtar) sayısı; bilinmiyorsa null. */
  tables: number | null;
  system: boolean;
  /**
   * SQLite: her dosya kendi bağlantı satırı (yol = bağlantı); seçilince bu
   * kimlik kullanılır. Sunucularda yok — veritabanı sunucunun bağlantısıyla açılır.
   */
  connectionId?: number;
  /** SQLite dosyasının host'taki yolu (ipucu olarak). */
  path?: string;
};

export type InventoryInstance = {
  connectionId: number;
  key: string;
  label: string;
  engine: DbEngine;
  transport: "docker" | "native";
  container: string;
  image: string;
  state: "running" | "stopped";
  /** Kimlik kendiliğinden bulundu mu (env, soket); yoksa kullanıcı girmeli. */
  credentials: "auto" | "manual" | "missing";
  databases: InventoryDatabase[];
  error: string;
};

export type DbUser = { name: string; host: string; superuser: boolean; grants: string[] };

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
