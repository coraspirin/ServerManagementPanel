import "server-only";

import { getDb } from "@/lib/db/client";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { audit } from "@/lib/auth/audit";
import { sanitizeRichText } from "@/lib/richtext";
import { findSetting, settingDefs } from "@/settings.schema";
import { serverT } from "@/lib/i18n/runtime";
import type { ResolvedSetting, SettingDef, SettingScope } from "./types";

/**
 * T9 — ayar çözümleme.
 *
 * Sıra: kaynak ezmesi → global ezme → şema varsayılanı.
 * Tablo yalnızca sapmaları tutar, bu yüzden ayar sayısı büyüdükçe maliyeti
 * artmaz.
 */

type Row = {
  value: string | null;
  value_encrypted: string | null;
  iv: string | null;
  auth_tag: string | null;
};

function parseValue(def: SettingDef, raw: string): string | number | boolean {
  switch (def.type) {
    case "int":
      return Number.parseInt(raw, 10);
    case "float":
      return Number.parseFloat(raw);
    case "bool":
      return raw === "1" || raw === "true";
    default:
      return raw;
  }
}

function serializeValue(def: SettingDef, value: unknown): string {
  if (def.type === "bool") return value ? "1" : "0";
  /*
    Zengin metin DEPOLANIRKEN temizleniyor, yalnızca çizilirken değil (M3.45).

    İstemci de temizliyor ama oraya güvenmek, uç noktayı doğrudan çağıran
    birine kapıyı açık bırakmak olurdu. Bu değer anonim karşılama sayfasında
    HTML olarak çiziliyor; kaydın kendisinin temiz olması, sonradan eklenecek
    ikinci bir okuyucunun da güvende olması demek.
  */
  if (def.type === "richtext") return sanitizeRichText(String(value));
  return String(value);
}

/** Şemaya göre doğrular; hatalıysa açıklayıcı mesaj döner. */
export function validateValue(def: SettingDef, value: unknown): string | null {
  switch (def.type) {
    case "int":
    case "float": {
      const n = Number(value);
      if (!Number.isFinite(n)) return serverT("settings.validation.number");
      if (def.type === "int" && !Number.isInteger(n)) return serverT("settings.validation.integer");
      if (def.min !== undefined && n < def.min)
        return serverT("settings.validation.min", { value: def.min });
      if (def.max !== undefined && n > def.max)
        return serverT("settings.validation.max", { value: def.max });
      return null;
    }
    case "bool":
      return typeof value === "boolean" || value === "0" || value === "1"
        ? null
        : serverT("settings.validation.bool");
    case "enum":
      return def.options?.includes(String(value))
        ? null
        : serverT("settings.validation.enum");
    case "cron": {
      const parts = String(value).trim().split(/\s+/);
      return parts.length === 5 ? null : serverT("settings.validation.cron");
    }
    case "time":
      return /^([01]\d|2[0-3]):[0-5]\d$/.test(String(value).trim())
        ? null
        : serverT("settings.validation.time");
    case "owner":
      return /^\d+:\d+$/.test(String(value).trim())
        ? null
        : serverT("settings.validation.owner");
    case "dir":
    case "dirs": {
      // Boş liste anlamlı: `files.roots` boşken dosya yöneticisi kapanıyor.
      const entries = String(value)
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean);
      if (def.type === "dir" && entries.length > 1)
        return serverT("settings.validation.singleDir");
      return entries.every((entry) => entry.startsWith("/"))
        ? null
        : serverT("settings.validation.absolutePath");
    }
    default:
      return typeof value === "string" ? null : serverT("settings.validation.text");
  }
}

function readRow(key: string, scopeType: SettingScope, scopeId: string): Row | undefined {
  return getDb()
    .prepare(
      `SELECT value, value_encrypted, iv, auth_tag FROM settings
       WHERE key = ? AND scope_type = ? AND scope_id = ?`,
    )
    .get(key, scopeType, scopeId) as Row | undefined;
}

/**
 * Şifresi çözülemeyen secret'ların anahtarları.
 *
 * MASTER_KEY değişirse (yeniden üretilir, yanlış kopyalanır, `.env` baştan
 * yazılır) eski kayıtlar okunamaz hale gelir. Bu, panelin ÇÖKMESİ için bir
 * sebep değil: okunamayan bir bildirim token'ı yüzünden Ayarlar ve Olaylar
 * ekranlarının tamamının 500 vermesi gerçek kurulumda yaşandı ve kullanıcıya
 * sorunun ne olduğunu da söylemedi.
 *
 * Değer "tanımsız" sayılıp varsayılana düşülüyor, anahtar burada birikiyor ve
 * Ayarlar ekranı "bu değer okunamıyor, yeniden gir" diyebiliyor.
 */
const unreadable = new Set<string>();

export function unreadableSecrets(): string[] {
  return [...unreadable];
}

function rowToValue(def: SettingDef, row: Row): string | number | boolean | null {
  if (def.type === "secret") {
    if (!row.value_encrypted || !row.iv || !row.auth_tag) return null;
    try {
      const value = decryptSecret({
        ciphertext: row.value_encrypted,
        iv: row.iv,
        authTag: row.auth_tag,
      });
      unreadable.delete(def.key);
      return value;
    } catch {
      // Her okumada log basmamak için yalnızca ilk seferinde uyarılıyor;
      // bu değerler sayfa başına onlarca kez okunabiliyor.
      if (!unreadable.has(def.key)) {
        unreadable.add(def.key);
        console.error(
          `[settings] "${def.key}" şifresi çözülemedi — MASTER_KEY, bu değer ` +
            "kaydedildiğindekinden farklı. Eski anahtar geri konmalı ya da değer yeniden girilmeli.",
        );
      }
      return null;
    }
  }
  return row.value === null ? null : parseValue(def, row.value);
}

/**
 * Tek ayarın etkin değeri. `scope` verilirse önce o kapsamdaki ezmeye bakılır.
 */
export function getSetting<T = string | number | boolean>(
  key: string,
  scope?: { type: SettingScope; id: string },
): T {
  const def = findSetting(key);
  if (!def) throw new Error(serverT("settings.validation.unknownKey", { key }));

  if (scope) {
    const row = readRow(key, scope.type, scope.id);
    if (row) {
      const value = rowToValue(def, row);
      if (value !== null) return value as T;
    }
  }

  const globalRow = readRow(key, "global", "");
  if (globalRow) {
    const value = rowToValue(def, globalRow);
    if (value !== null) return value as T;
  }

  return def.default as T;
}

export function getNumber(key: string, scope?: { type: SettingScope; id: string }): number {
  return Number(getSetting(key, scope));
}

export function getBool(key: string, scope?: { type: SettingScope; id: string }): boolean {
  return Boolean(getSetting(key, scope));
}

export function getString(key: string, scope?: { type: SettingScope; id: string }): string {
  return String(getSetting(key, scope));
}

export type SetResult = { ok: true } | { ok: false; error: string };

export function setSetting(
  key: string,
  value: unknown,
  options: {
    scopeType?: SettingScope;
    scopeId?: string;
    updatedBy: string;
    userId?: number;
  },
): SetResult {
  const def = findSetting(key);
  if (!def) return { ok: false, error: serverT("settings.validation.unknownKey", { key }) };

  const scopeType = options.scopeType ?? "global";
  const scopeId = options.scopeId ?? "";

  if (scopeType !== "global" && !def.overridable) {
    return { ok: false, error: serverT("settings.screen.notOverridable") };
  }

  const problem = validateValue(def, value);
  if (problem) return { ok: false, error: problem };

  const db = getDb();
  const previous = def.type === "secret" ? "(gizli)" : String(getSetting(key, { type: scopeType, id: scopeId }));

  if (def.type === "secret") {
    const enc = encryptSecret(String(value));
    db.prepare(
      `INSERT INTO settings (key, scope_type, scope_id, value, value_encrypted, iv, auth_tag, updated_at, updated_by)
       VALUES (?, ?, ?, NULL, ?, ?, ?, unixepoch(), ?)
       ON CONFLICT(key, scope_type, scope_id) DO UPDATE SET
         value = NULL, value_encrypted = excluded.value_encrypted,
         iv = excluded.iv, auth_tag = excluded.auth_tag,
         updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
    ).run(key, scopeType, scopeId, enc.ciphertext, enc.iv, enc.authTag, options.updatedBy);
  } else {
    db.prepare(
      `INSERT INTO settings (key, scope_type, scope_id, value, updated_at, updated_by)
       VALUES (?, ?, ?, ?, unixepoch(), ?)
       ON CONFLICT(key, scope_type, scope_id) DO UPDATE SET
         value = excluded.value, value_encrypted = NULL, iv = NULL, auth_tag = NULL,
         updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
    ).run(key, scopeType, scopeId, serializeValue(def, value), options.updatedBy);
  }

  audit({
    userId: options.userId,
    username: options.updatedBy,
    action: "settings.update",
    targetType: scopeType,
    targetId: scopeId || key,
    detail:
      def.type === "secret"
        ? `${key}: (gizli değer güncellendi)`
        : `${key}: ${previous} → ${String(value)}`,
  });

  return { ok: true };
}

export function resetSetting(
  key: string,
  options: { scopeType?: SettingScope; scopeId?: string; updatedBy: string; userId?: number },
): SetResult {
  const def = findSetting(key);
  if (!def) return { ok: false, error: serverT("settings.validation.unknownKey", { key }) };

  getDb()
    .prepare("DELETE FROM settings WHERE key = ? AND scope_type = ? AND scope_id = ?")
    .run(key, options.scopeType ?? "global", options.scopeId ?? "");

  audit({
    userId: options.userId,
    username: options.updatedBy,
    action: "settings.reset",
    targetId: key,
    detail: `varsayılana döndürüldü (${String(def.default)})`,
  });

  return { ok: true };
}

/** Ayarlar ekranı için: tüm tanımlar + etkin değerler + değerin kaynağı. */
export function resolveAll(): ResolvedSetting[] {
  return settingDefs.map((def) => {
    const row = readRow(def.key, "global", "");
    const overridden = row !== undefined && rowToValue(def, row) !== null;

    if (def.type === "secret") {
      // Satır var ama çözülemiyorsa: değer "yok" değil, OKUNAMIYOR. İkisini
      // aynı göstermek kullanıcıyı boş bir alana bakıp "ama ben girmiştim"
      // dedirtir.
      const broken = row !== undefined && unreadable.has(def.key);
      return {
        key: def.key,
        value: "",
        source: overridden ? "global" : "default",
        isSecret: true,
        hasValue: overridden,
        unreadable: broken,
      };
    }

    return {
      key: def.key,
      value: overridden ? (rowToValue(def, row) as string | number | boolean) : def.default,
      source: overridden ? "global" : "default",
      isSecret: false,
    };
  });
}

/**
 * T9 — env tohumlama. Yalnızca BİR KEZ çalışır: env'de karşılığı olan ayarlar
 * veritabanına yazılır, sonrasında env yok sayılır ve panelden yapılan
 * değişiklik otoriterdir.
 */
export function seedFromEnv(): string[] {
  const db = getDb();
  const seeded: string[] = [];

  for (const def of settingDefs) {
    if (!def.envVar) continue;

    const already = db
      .prepare("SELECT 1 FROM settings_seed_log WHERE key = ?")
      .get(def.key);
    if (already) continue;

    const raw = process.env[def.envVar];
    // Tohumlama denemesi bir kez kaydedilir; env sonradan eklenirse de
    // panelden yapılmış bir değişikliği ezmemek için tekrar denenmez.
    db.prepare("INSERT INTO settings_seed_log (key, env_var) VALUES (?, ?)").run(
      def.key,
      def.envVar,
    );

    if (raw === undefined || raw === "") continue;
    if (validateValue(def, def.type === "int" ? Number(raw) : raw)) continue;

    db.prepare(
      `INSERT OR IGNORE INTO settings (key, scope_type, scope_id, value, updated_by)
       VALUES (?, 'global', '', ?, 'env')`,
    ).run(def.key, raw);
    seeded.push(`${def.key}=${raw}`);
  }

  return seeded;
}

/** Bir ayarın env'den tohumlanıp tohumlanmadığı (UI'da rozet gösterilir). */
export function seededKeys(): Set<string> {
  return new Set(
    (getDb().prepare("SELECT key FROM settings_seed_log").all() as { key: string }[]).map(
      (r) => r.key,
    ),
  );
}
