import "server-only";

import { readFile } from "node:fs/promises";
import path from "node:path";

import { audit } from "@/lib/auth/audit";
import { elevatedRead, isPermissionError } from "@/lib/files/elevated";
import { hostRoot } from "@/lib/files/paths";
import { callHelper } from "@/lib/host/helper";
import { panelImage } from "@/lib/host/self";
import { getDockerProvider } from "@/lib/providers";
import { getNumber } from "@/lib/settings";

import type { ComposeLocation } from "./locate.ts";

/**
 * Compose dosyasının okunması, yazılması ve uygulanması (M3.19).
 *
 * AKIŞ VE NEDEN BU SIRADA:
 *
 *   1. oku → 2. değiştir → 3. YEDEKLE → 4. yaz → 5. `compose config` ile
 *   DOĞRULA → (bozuksa yedeği geri yükle ve dur) → 6. `compose up -d`
 *
 * M3.10'da kurulum için konan kural "var olan dosyanın üzerine ASLA yazma"ydı
 * ve gerekçesi `install.ts`'te yazılı: *"çalışan bir yığının compose'unu
 * SESSİZCE değiştirmek olurdu."* İtiraz sessizliğe yönelikti, değişikliğe
 * değil. Burada değişiklik kullanıcının açık isteği, diff'i önden gösteriliyor,
 * yedeği alınıyor ve doğrulama başarısızsa geri alınıyor — yani kuralın
 * koruduğu şey korunuyor.
 *
 * ⚠️ 5. ADIM ATLANAMAZ. Doğrulamadan `compose up` çağırmak, bozuk bir dosyayla
 * çalışan yığını durdurma riski demek. Bozuk dosya bırakmak kabul edilebilir
 * en kötü sonuç değil — kabul edilemez olan.
 */

/** Env değişkeniyle taşınabilecek üst sınır (Linux MAX_ARG_STRLEN 128 KB). */
export const MAX_EDIT_BYTES = 100 * 1024;

export type ComposeReadResult = { text: string; error: null } | { text: null; error: string };

/**
 * Compose dosyasını okur.
 *
 * Önce panelin kendi salt-okunur host bağından denenip, izin reddinde
 * yükseltilmiş okumaya düşülüyor — dosya yöneticisinin (M3.5) aynı deseni.
 * Her okuma için container açmak, bir popup'ı saniyelerce bekletirdi.
 */
export async function readComposeFile(location: ComposeLocation): Promise<ComposeReadResult> {
  const containerPath = path.posix.join(hostRoot(), location.file);

  try {
    const buffer = await readFile(containerPath);
    return { text: buffer.toString("utf8"), error: null };
  } catch (error) {
    if (!isPermissionError(error)) {
      return {
        text: null,
        error: `${location.file} okunamadı: ${error instanceof Error ? error.message : "bilinmeyen hata"}`,
      };
    }
  }

  const elevated = await elevatedRead(containerPath, MAX_EDIT_BYTES);
  if ("error" in elevated) return { text: null, error: `${location.file}: ${elevated.error}` };
  return { text: elevated.buffer.toString("utf8"), error: null };
}

function backupName(file: string): string {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  const stamp =
    `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
    `-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `${path.posix.basename(file)}.panel-yedek-${stamp}`;
}

/**
 * Yedekle + yaz + eski yedekleri buda.
 *
 * Tek script'te, çünkü üçü arasında başka bir sürecin araya girmesi istenmiyor.
 * Yedek adı sıralanabilir zaman damgası taşıyor; budama alfabetik sıraya
 * güveniyor.
 */
const WRITE_SCRIPT =
  'const fs=require("node:fs");' +
  'const dir="/work";' +
  "const name=process.env.NAME;" +
  'const target=dir+"/"+name;' +
  "try{" +
  'fs.copyFileSync(target,dir+"/"+process.env.BACKUP);' +
  '}catch(e){if(e.code!=="ENOENT")throw e;}' +
  "fs.writeFileSync(target,process.env.CONTENT);" +
  'const prefix=name+".panel-yedek-";' +
  "const keep=Number(process.env.KEEP);" +
  "const list=fs.readdirSync(dir).filter(function(f){return f.indexOf(prefix)===0;}).sort();" +
  "for(const f of list.slice(0,Math.max(0,list.length-keep))){" +
  'try{fs.unlinkSync(dir+"/"+f);}catch(e){}' +
  "}" +
  'console.log("YAZILDI");';

const RESTORE_SCRIPT =
  'const fs=require("node:fs");' +
  'fs.copyFileSync("/work/"+process.env.BACKUP,"/work/"+process.env.NAME);' +
  'console.log("GERI_YUKLENDI");';

export type EditOutcome = {
  ok: boolean;
  message: string;
  /** `compose config`'in uyarıları — çıkış kodu 0 olsa bile dolu olabilir. */
  warnings: string;
  /** Alınan yedeğin adı; kullanıcıya nereye bakacağını söylemek için. */
  backup: string | null;
  /**
   * Dosya yazıldı ama yığın ŞU AN AYAKTA DEĞİL (M3.21).
   *
   * passbolt'ta `compose up` "port is already allocated" ile başarısız oldu ve
   * container `Created` durumunda kaldı. Panel "başlatılamadı" dedi ama bunu
   * sıradan bir hata metni olarak gösterdi; kullanıcı yığının tamamen durduğunu
   * fark etmedi. Bu bayrak arayüzün ayrı ve yüksek sesle uyarmasını sağlıyor.
   */
  stackDown: boolean;
};

async function runInStack(
  location: ComposeLocation,
  script: string,
  env: Record<string, string>,
): Promise<{ ok: boolean; output: string }> {
  const image = await panelImage();
  if (!image) return { ok: false, output: "Panel imajı belirlenemedi." };

  const directory = path.posix.dirname(location.file);
  const result = await getDockerProvider().runThrowaway({
    image,
    cmd: ["node", "-e", script],
    // Yalnızca compose dosyasının bulunduğu dizin bağlanıyor.
    binds: [`${directory}:/work`],
    env,
    namePrefix: "panel-compose",
    timeoutMs: 60_000,
    user: "0:0",
  });

  return { ok: result.exitCode === 0, output: result.output };
}

/**
 * Değiştirilmiş compose metnini yazar, doğrular ve uygular.
 *
 * `actor` yalnızca denetim kaydı ve helper çağrısı için; yetki kontrolü
 * çağıran route'ta yapılıyor (`guardApi`).
 */
export async function applyComposeEdit(
  location: ComposeLocation,
  text: string,
  actor: { username: string; userId: number },
  options: { restart: boolean } = { restart: true },
): Promise<EditOutcome> {
  if (Buffer.byteLength(text, "utf8") > MAX_EDIT_BYTES) {
    return {
      ok: false,
      message: `Compose dosyası ${Math.round(MAX_EDIT_BYTES / 1024)} KB sınırını aşıyor.`,
      warnings: "",
      backup: null,
      stackDown: false,
    };
  }

  const name = path.posix.basename(location.file);
  const backup = backupName(location.file);

  const written = await runInStack(location, WRITE_SCRIPT, {
    NAME: name,
    BACKUP: backup,
    CONTENT: text,
    KEEP: String(getNumber("appstore.keep_backups")),
  });

  if (!written.ok) {
    return {
      ok: false,
      message: `${location.file} yazılamadı: ${written.output.slice(0, 400)}`,
      warnings: "",
      backup: null,
      stackDown: false,
    };
  }

  // DOĞRULAMA — atlanamaz. Bozuk bir dosyayla `up` çağırmak yığını durdurur.
  const check = await callHelper("compose.config", { dir: location.workingDir }, actor);
  const configFailed = !check.ok || (check.exitCode ?? 1) !== 0;

  if (configFailed) {
    const restored = await runInStack(location, RESTORE_SCRIPT, { NAME: name, BACKUP: backup });
    const detail = (check.stderr || check.stdout || check.error || "").slice(0, 600);

    audit({
      userId: actor.userId,
      username: actor.username,
      action: "compose.edit",
      targetType: "compose_file",
      targetId: `${location.project}/${location.service}`,
      detail: restored.ok
        ? `${location.file} doğrulamayı geçemedi, değişiklik geri alındı`
        : `${location.file} doğrulamayı geçemedi VE geri yüklenemedi (yedek: ${backup})`,
      result: "error",
    });

    return {
      ok: false,
      message: restored.ok
        ? `Compose doğrulaması başarısız — değişiklik GERİ ALINDI, dosya eski hâlinde.\n\n${detail}`
        : `Compose doğrulaması başarısız VE geri yükleme de başarısız oldu. ` +
          `${location.file} bozuk durumda olabilir; yedek: ${backup}\n\n${detail}`,
      warnings: "",
      backup,
      // Dosya eski hâline döndü; yığına dokunulmadı, hâlâ eski hâliyle ayakta.
      stackDown: false,
    };
  }

  // Çıkış kodu 0 olsa bile stderr dolu olabilir: compose tanımsız
  // `${DEĞİŞKEN}` ve kullanımdan kalkmış anahtar uyarılarını buraya yazıyor.
  // Bu uyarılar bugüne kadar okunup atılıyordu (bkz. install.ts) — oysa
  // "parola boş kaldı" gibi sessiz hataların tek erken işareti onlar.
  const warnings = (check.stderr ?? "").trim().slice(0, 600);

  /**
   * Denetim kaydı `compose up`'ın SONRASINDA yazılıyor (M3.21).
   *
   * Önce yazılıyordu ve `result` her zaman "ok"tu — passbolt'ta yığın hiç
   * kalkmadığı hâlde kayıt başarılı görünüyordu. Bir denetim kaydının işi
   * "ne denendi"yi değil "ne oldu"yu anlatmak.
   */
  const kaydet = (result: "ok" | "error", detail: string) =>
    audit({
      userId: actor.userId,
      username: actor.username,
      action: "compose.edit",
      targetType: "compose_file",
      targetId: `${location.project}/${location.service}`,
      detail,
      result,
    });

  if (!options.restart) {
    kaydet("ok", `${location.file} güncellendi, yığın başlatılmadı (yedek: ${backup})`);
    return {
      ok: true,
      message: "Dosya güncellendi; yığın yeniden başlatılmadı.",
      warnings,
      backup,
      stackDown: false,
    };
  }

  const up = await callHelper("compose.up", { dir: location.workingDir }, actor);
  if (!up.ok || (up.exitCode ?? 1) !== 0) {
    const detail = (up.stderr || up.error || up.stdout || "").slice(0, 600);
    kaydet("error", `${location.file} güncellendi ama compose up başarısız: ${detail.slice(0, 200)}`);

    return {
      ok: false,
      message:
        "Dosya güncellendi ve geçerli, ama yığın başlatılamadı:\n\n" + detail,
      warnings,
      backup,
      stackDown: true,
    };
  }

  kaydet("ok", `${location.file} güncellendi ve uygulandı (yedek: ${backup})`);

  return {
    ok: true,
    message: (up.stdout ?? "").trim() || "Uygulandı.",
    warnings,
    backup,
    stackDown: false,
  };
}

/** Yedek adı kalıbı: `<dosya>.panel-yedek-YYYYAAGG-SSDDss`. */
const BACKUP_STAMP = /^\d{8}-\d{6}$/;

/**
 * Alınan bir yedeği geri yükler ve yığını yeniden başlatır (M3.21).
 *
 * ⚠️ `backup` İSTEMCİDEN GELİYOR ve bu uç, adı verilen dosyayı compose
 * dosyasının üzerine kopyalıyor. Doğrulama olmadan bu, compose dizinindeki
 * herhangi bir dosyayı — ya da `../` ile dizin dışını — compose dosyası hâline
 * getiren bir araca dönüşürdü. Bu yüzden ad, panelin kendi ürettiği kalıba
 * BİREBİR uymak zorunda; uymayan istek dosyaya hiç ulaşmıyor.
 */
export async function restoreComposeBackup(
  location: ComposeLocation,
  backup: string,
  actor: { username: string; userId: number },
): Promise<EditOutcome> {
  const name = path.posix.basename(location.file);
  const prefix = `${name}.panel-yedek-`;

  const gecerli =
    backup.startsWith(prefix) && BACKUP_STAMP.test(backup.slice(prefix.length));

  if (!gecerli) {
    return {
      ok: false,
      message: `Geçersiz yedek adı: ${backup}`,
      warnings: "",
      backup: null,
      stackDown: false,
    };
  }

  const restored = await runInStack(location, RESTORE_SCRIPT, { NAME: name, BACKUP: backup });
  if (!restored.ok) {
    return {
      ok: false,
      message: `Yedek geri yüklenemedi: ${restored.output.slice(0, 400)}`,
      warnings: "",
      backup,
      stackDown: true,
    };
  }

  const up = await callHelper("compose.up", { dir: location.workingDir }, actor);
  const upFailed = !up.ok || (up.exitCode ?? 1) !== 0;

  audit({
    userId: actor.userId,
    username: actor.username,
    action: "compose.restore",
    targetType: "compose_file",
    targetId: `${location.project}/${location.service}`,
    detail: `${location.file} ← ${backup}`,
    result: upFailed ? "error" : "ok",
  });

  if (upFailed) {
    return {
      ok: false,
      message:
        "Dosya yedekten geri yüklendi ama yığın yine başlatılamadı:\n\n" +
        (up.stderr || up.error || up.stdout || "").slice(0, 600),
      warnings: "",
      backup,
      stackDown: true,
    };
  }

  return {
    ok: true,
    message: `${backup} geri yüklendi ve yığın başlatıldı.`,
    warnings: "",
    backup,
    stackDown: false,
  };
}

/** Dizindeki panel yedeklerini yeniden eskiye doğru listeler. */
const LIST_SCRIPT =
  'const fs=require("node:fs");' +
  'const prefix=process.env.NAME+".panel-yedek-";' +
  'const list=fs.readdirSync("/work").filter(function(f){return f.indexOf(prefix)===0;}).sort().reverse();' +
  "console.log(JSON.stringify(list));";

export async function listComposeBackups(location: ComposeLocation): Promise<string[]> {
  const name = path.posix.basename(location.file);
  const result = await runInStack(location, LIST_SCRIPT, { NAME: name });
  if (!result.ok) return [];

  try {
    const parsed = JSON.parse(result.output.trim().split("\n").pop() ?? "[]");
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}
