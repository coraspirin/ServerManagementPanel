import "server-only";

import { createHmac, randomBytes, randomInt } from "node:crypto";

/**
 * M3.1 — RFC 6238 TOTP (RFC 4226 HOTP üzerine).
 *
 * Kütüphane değil kendi kodumuz: algoritma 40 satır ve doğrulaması RFC'nin
 * kendi test vektörleriyle yapılabiliyor. Buna karşılık bir bağımlılık,
 * kimlik doğrulama yolunun ortasına başkasının güncelleme takvimini sokardı.
 *
 * SHA-1 kullanılıyor — zayıf olduğu için değil, Google Authenticator, Aegis,
 * 1Password ve iOS'un yerleşik kod üreticisi pratikte yalnızca bunu okuyor.
 * HMAC-SHA1'in burada kırılması söz konusu değil (30 saniyede bir 6 hane).
 */

const DIGITS = 6;
const PERIOD = 30;
/** Telefon saati panelden birkaç saniye kayabilir; bir adım öncesi/sonrası kabul. */
const DRIFT_STEPS = 1;

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(buffer: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = "";

  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }

  if (bits > 0) output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return output;
}

export function base32Decode(input: string): Buffer {
  const clean = input.replace(/[\s=-]/g, "").toUpperCase();
  const bytes: number[] = [];
  let bits = 0;
  let value = 0;

  for (const char of clean) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index < 0) throw new Error("Geçersiz base32 karakteri.");
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }

  return Buffer.from(bytes);
}

/** 20 bayt = SHA-1'in blok boyutu; RFC 4226'nın önerdiği sır uzunluğu. */
export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

function hotp(secret: Buffer, counter: number): string {
  const counterBytes = Buffer.alloc(8);
  // 2^53'e kadar güvenli: counter = unixTime/30, yani ~8.5 milyar yıl.
  counterBytes.writeUInt32BE(Math.floor(counter / 2 ** 32), 0);
  counterBytes.writeUInt32BE(counter >>> 0, 4);

  const digest = createHmac("sha1", secret).update(counterBytes).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary =
    ((digest[offset] & 0x7f) << 24) |
    (digest[offset + 1] << 16) |
    (digest[offset + 2] << 8) |
    digest[offset + 3];

  return String(binary % 10 ** DIGITS).padStart(DIGITS, "0");
}

export function totpCode(secretBase32: string, atSeconds = Math.floor(Date.now() / 1000)): string {
  return hotp(base32Decode(secretBase32), Math.floor(atSeconds / PERIOD));
}

/**
 * Kodu doğrular. Karşılaştırma sabit zamanlı DEĞİL ve olması da gerekmiyor:
 * doğru kod zaten 30 saniye sonra geçersiz oluyor ve deneme sayısı sınırlı.
 */
export function verifyTotp(
  secretBase32: string,
  code: string,
  atSeconds = Math.floor(Date.now() / 1000),
): boolean {
  const clean = code.replace(/\D/g, "");
  if (clean.length !== DIGITS) return false;

  const secret = base32Decode(secretBase32);
  const step = Math.floor(atSeconds / PERIOD);

  for (let drift = -DRIFT_STEPS; drift <= DRIFT_STEPS; drift += 1) {
    if (hotp(secret, step + drift) === clean) return true;
  }
  return false;
}

/** Kimlik doğrulayıcı uygulamaların okuduğu standart URI. */
export function otpauthUri(secretBase32: string, username: string, issuer: string): string {
  const label = encodeURIComponent(`${issuer}:${username}`);
  const params = new URLSearchParams({
    secret: secretBase32,
    issuer,
    algorithm: "SHA1",
    digits: String(DIGITS),
    period: String(PERIOD),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

/**
 * Kurtarma kodları. Telefonun kaybolması hesabı kaybetmek anlamına gelmemeli;
 * bunlar 2FA'nın tek çıkış kapısı, bu yüzden okunaklı gruplar hâlinde üretilip
 * kullanıcıya BİR KEZ gösterilir ve veritabanında yalnızca özetleri kalır.
 */
export function generateRecoveryCodes(count = 10): string[] {
  const codes: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const half = () => String(randomInt(0, 100000)).padStart(5, "0");
    codes.push(`${half()}-${half()}`);
  }
  return codes;
}

export function normalizeRecoveryCode(code: string): string {
  return code.replace(/\D/g, "");
}
