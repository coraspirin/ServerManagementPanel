import "server-only";
import { serverT } from "@/lib/i18n/runtime";

import { randomInt } from "node:crypto";
import { getDb } from "@/lib/db/client";
import { deleteCache, readCache, writeCache } from "@/lib/db/cache";
import { hashToken, safeEquals } from "@/lib/crypto";
import { audit } from "./audit";
import { createUser, type Outcome } from "./users";

/**
 * İlk kurulum sihirbazı (/kurulum).
 *
 * Kullanıcı tablosu boşken panel kimseyi kendiliğinden oluşturmaz; ilk
 * yönetici tarayıcıdan açılır. Sayfa o an herkese açık olduğu için ağdaki
 * başka biri paneli kapmasın diye her açılışta tek kullanımlık bir kurulum
 * kodu üretilip YALNIZCA container loguna yazılır — logu okuyabilen, sunucuya
 * zaten erişebilen kişidir.
 *
 * Kod bellekte değil `cache` tablosunda (özeti) tutuluyor: instrumentation ile
 * route'lar ayrı bundle'larda çalışıyor, modül değişkeni paylaşılmıyor.
 *
 * Eskiden burada `ADMIN_PASSWORD` env'iyle (yoksa loga rastgele parola)
 * hesap açan bootstrap vardı; bkz. _Claude/kararlar.md.
 */

const CODE_KEY = "auth:setup-code";

/** Karıştırılabilecek karakterler (0/O, 1/I/L) yok — kod logdan elle yazılıyor. */
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const GROUPS = 3;
const GROUP_LEN = 4;

export function needsSetup(): boolean {
  const { n } = getDb().prepare("SELECT COUNT(*) AS n FROM users").get() as { n: number };
  return Number(n) === 0;
}

/** Yazım farklarını yok sayar: küçük harf, boşluk ve tire kabul. */
function normalize(code: string): string {
  return code.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/**
 * Açılışta bir kez çağrılır. Kurulum gerekmiyorsa eski kod (varsa) silinir;
 * gerekiyorsa yenisi üretilir — her yeniden başlatma bir öncekini geçersiz kılar.
 */
export function prepareSetupCode(): void {
  if (!needsSetup()) {
    deleteCache(CODE_KEY);
    return;
  }

  const groups: string[] = [];
  for (let g = 0; g < GROUPS; g++) {
    let part = "";
    for (let i = 0; i < GROUP_LEN; i++) part += ALPHABET[randomInt(ALPHABET.length)];
    groups.push(part);
  }
  const code = groups.join("-");
  writeCache(CODE_KEY, hashToken(normalize(code)));

  const banner = "=".repeat(64);
  console.log(`\n${banner}`);
  console.log("  KURULUM GEREKLİ — henüz kullanıcı yok"); // i18n-ignore — operatör logu
  console.log("  Tarayıcıda /kurulum sayfasını açın ve şu kodu girin:"); // i18n-ignore — operatör logu
  console.log(`  Kurulum kodu : ${code}`); // i18n-ignore — operatör logu
  console.log("  Kod her yeniden başlatmada değişir."); // i18n-ignore — operatör logu
  console.log(`${banner}\n`);
}

export type SetupFailure = "done" | "code" | "invalid";

/**
 * İlk yöneticiyi oluşturur. `node:sqlite` senkron: kontrol ile ekleme arasına
 * başka bir istek giremez, iki eşzamanlı gönderimden yalnızca biri geçer.
 */
export function completeSetup(input: {
  code: string;
  username: string;
  displayName: string;
  password: string;
  ip: string;
}): Outcome<{ userId: number; username: string }> & { reason?: SetupFailure } {
  if (!needsSetup()) {
    return { ok: false, error: serverT("setup.errors.done"), reason: "done" };
  }

  const stored = readCache<string>(CODE_KEY)?.value;
  if (!stored || !safeEquals(hashToken(normalize(input.code)), stored)) {
    audit({ action: "auth.setup", ip: input.ip, result: "denied" });
    return { ok: false, error: serverT("setup.errors.badCode"), reason: "code" };
  }

  const created = createUser({
    username: input.username,
    displayName: input.displayName.trim() || input.username.trim(),
    password: input.password,
    roleId: 1,
    mustChangePassword: false,
  });
  if (!created.ok) return { ...created, reason: "invalid" };

  deleteCache(CODE_KEY);
  audit({
    userId: created.result.id,
    username: created.result.username,
    action: "auth.setup",
    detail: serverT("setup.auditDetail"),
    ip: input.ip,
  });
  return { ok: true, result: { userId: created.result.id, username: created.result.username } };
}
