import "server-only";

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";

/**
 * T3 — secret şifreleme ve parola özetleme.
 *
 * Parola özetleme için `node:crypto`'nun scrypt'i kullanılıyor (argon2/bcrypt
 * gibi native bağımlılık gerekmiyor — node:sqlite ile aynı gerekçe).
 *
 * ŞİFRELEMENİN SINIRI: AES-GCM yalnızca veritabanı dosyası TEK BAŞINA sızarsa
 * korur. MASTER_KEY ile DB aynı yedeğe girerse koruma sıfırdır. Bu yüzden
 * yedekleme `.env`'i hariç tutar ve anahtar panel dışında ayrıca saklanır.
 */

const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1 } as const;
const KEY_LEN = 64;

let cachedKey: Buffer | null = null;

/** 32 baytlık ana anahtar. Yoksa açıkça hata verir — sessizce zayıf moda düşmez. */
function masterKey(): Buffer {
  if (cachedKey) return cachedKey;

  const raw = process.env.MASTER_KEY;
  if (!raw) {
    throw new Error(
      "MASTER_KEY tanımlı değil. Üretmek için: " +
        "node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"",
    );
  }

  const key = Buffer.from(raw.trim(), "hex");
  if (key.length !== 32) {
    throw new Error(
      `MASTER_KEY 32 bayt (64 hex karakter) olmalı, ${key.length} bayt bulundu.`,
    );
  }

  cachedKey = key;
  return key;
}

export function masterKeyAvailable(): boolean {
  try {
    masterKey();
    return true;
  } catch {
    return false;
  }
}

export type EncryptedValue = {
  ciphertext: string;
  iv: string;
  authTag: string;
};

export function encryptSecret(plaintext: string): EncryptedValue {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", masterKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return {
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
  };
}

export function decryptSecret(value: EncryptedValue): string {
  const decipher = createDecipheriv(
    "aes-256-gcm",
    masterKey(),
    Buffer.from(value.iv, "base64"),
  );
  decipher.setAuthTag(Buffer.from(value.authTag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(value.ciphertext, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

/** Depolama biçimi: scrypt$N$r$p$salt$hash — parametreler sonradan yükseltilebilsin diye. */
export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, KEY_LEN, SCRYPT_PARAMS);
  const { N, r, p } = SCRYPT_PARAMS;
  return `scrypt$${N}$${r}$${p}$${salt.toString("base64")}$${hash.toString("base64")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;

  const [, n, r, p, saltB64, hashB64] = parts;
  const expected = Buffer.from(hashB64, "base64");

  let actual: Buffer;
  try {
    actual = scryptSync(password, Buffer.from(saltB64, "base64"), expected.length, {
      N: Number(n),
      r: Number(r),
      p: Number(p),
    });
  } catch {
    return false;
  }

  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/** Session ve CSRF token'ları için kriptografik rastgele değer. */
export function generateToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

/**
 * Session token'ı veritabanında düz tutulmaz; yalnızca özeti saklanır.
 * DB sızarsa oturumlar ele geçirilemez.
 */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function safeEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
}
