import "server-only";
import { serverT } from "@/lib/i18n/runtime";

import { audit } from "@/lib/auth/audit";
import { elevatedList, elevatedRead } from "@/lib/files/elevated";
import { hostRoot } from "@/lib/files/paths";
import { panelImage } from "@/lib/host/self";
import { getDockerProvider } from "@/lib/providers";
import { getString } from "@/lib/settings";

/**
 * M3.9 — host zamanlanmış görevleri.
 *
 * PANEL İŞLERİYLE KARIŞTIRILMAMALI. Panel İşleri (M0.6) panelin kendi arka
 * plan turlarıdır ve panel durunca dururlar. Buradakiler HOST'un cron'udur:
 * panel silinse bile çalışmaya devam ederler. Ekranda ayrı başlık altında
 * duruyorlar ve bu ayrım her iki yerde de yazılı.
 *
 * OKUMA yükseltilmiş container'dan (cron dosyaları root'a ait).
 * YAZMA yalnızca `/etc/cron.d/panel-*` dosyalarına: panelin yazdığı görevler
 * kendi ad alanında duruyor ve sistemin ya da kullanıcının kendi crontab'ına
 * hiç dokunulmuyor. Yanlışlıkla `/etc/crontab`'ı bozmak, sunucunun bakım
 * görevlerini sessizce durdurmak olurdu.
 */

const PANEL_PREFIX = "panel-";
const CRON_D = "/etc/cron.d";

export type CronEntry = {
  /** Dosya + satır numarası; düzenleme hedefini belirler. */
  id: string;
  source: string;
  /** Panel tarafından yönetiliyor mu (yalnızca bunlar düzenlenebilir). */
  managed: boolean;
  schedule: string;
  /** /etc/crontab ve /etc/cron.d biçiminde komuttan önce kullanıcı alanı var. */
  user: string;
  command: string;
  comment: string;
  enabled: boolean;
  raw: string;
};

export type CronState = {
  entries: CronEntry[];
  error: string | null;
};

const SPECIALS = new Set(["@reboot", "@yearly", "@annually", "@monthly", "@weekly", "@daily", "@midnight", "@hourly"]);

/**
 * Bir cron dosyasını ayrıştırır.
 *
 * `withUser` ayrımı önemli: `/etc/crontab` ve `/etc/cron.d/*` zamanlamadan
 * sonra KULLANICI alanı taşır, kullanıcı crontab'ları taşımaz. Karıştırmak,
 * komutun ilk kelimesini yutmak demek.
 */
export function parseCronFile(
  text: string,
  source: string,
  withUser: boolean,
  managed: boolean,
): CronEntry[] {
  const entries: CronEntry[] = [];
  let pendingComment = "";

  text.split("\n").forEach((line, index) => {
    const trimmed = line.trim();
    if (trimmed.length === 0) {
      pendingComment = "";
      return;
    }

    // "#" ile başlayan satır ya yorum ya da kapatılmış bir görev.
    const disabled = trimmed.startsWith("#");
    const body = disabled ? trimmed.replace(/^#+\s*/, "") : trimmed;

    /*
      Kapatılmış satırlar YALNIZCA panelin kendi dosyalarında görev sayılıyor.
      Sistem dosyalarındaki yorumlar neredeyse her zaman belgelendirmedir —
      Ubuntu'nun /etc/crontab'ındaki "# * * * * * user-name command to be
      executed" örnek satırı, biçim olarak geçerli bir görev gibi görünüyor ve
      listede sahte bir kayıt olarak çıkıyordu (sunucuda görüldü).
    */
    if (disabled && !managed) return;

    // Ortam değişkeni ataması (PATH=..., SHELL=...) görev değil.
    if (/^[A-Z_][A-Z0-9_]*\s*=/.test(body)) return;

    const parts = body.split(/\s+/);
    const isSpecial = SPECIALS.has(parts[0]);
    const fieldCount = isSpecial ? 1 : 5;

    if (!isSpecial && parts.length < 6) {
      if (disabled) pendingComment = body;
      return;
    }
    // Zamanlama alanları rakam/*/,/-// dışında bir şey içeriyorsa bu bir görev
    // değil, serbest bir yorum satırıdır.
    if (!isSpecial && !parts.slice(0, 5).every((field) => /^[\d*,/-]+$/.test(field))) {
      if (disabled) pendingComment = body;
      return;
    }

    const schedule = parts.slice(0, fieldCount).join(" ");
    const rest = parts.slice(fieldCount);
    const user = withUser ? (rest.shift() ?? "") : "";

    entries.push({
      id: `${source}:${index}`,
      source,
      managed,
      schedule,
      user,
      command: rest.join(" "),
      comment: pendingComment,
      enabled: !disabled,
      raw: trimmed,
    });

    pendingComment = "";
  });

  return entries;
}

async function readFile(hostPath: string): Promise<string | null> {
  const result = await elevatedRead(`${hostRoot()}${hostPath}`, 256 * 1024);
  return "error" in result ? null : result.buffer.toString("utf8");
}

export async function readCron(): Promise<CronState> {
  try {
    const entries: CronEntry[] = [];

    const system = await readFile("/etc/crontab");
    if (system) entries.push(...parseCronFile(system, "/etc/crontab", true, false));

    const dir = await elevatedList(`${hostRoot()}${CRON_D}`, 200);
    if (!("error" in dir)) {
      for (const file of dir.entries) {
        // cron.d, nokta içeren dosya adlarını yok sayar; panel de saymamalı
        // yoksa "kaydettim ama çalışmıyor" durumu oluşur.
        if (file.kind !== "file" || file.name.includes(".")) continue;
        const text = await readFile(`${CRON_D}/${file.name}`);
        if (!text) continue;
        entries.push(
          ...parseCronFile(
            text,
            `${CRON_D}/${file.name}`,
            true,
            file.name.startsWith(PANEL_PREFIX),
          ),
        );
      }
    }

    const spool = await elevatedList(`${hostRoot()}/var/spool/cron/crontabs`, 100);
    if (!("error" in spool)) {
      for (const file of spool.entries) {
        if (file.kind !== "file") continue;
        const text = await readFile(`/var/spool/cron/crontabs/${file.name}`);
        if (!text) continue;
        entries.push(
          ...parseCronFile(text, serverT("hostcronLib.userSource", { name: file.name }), false, false),
        );
      }
    }

    return { entries, error: null };
  } catch (error) {
    return {
      entries: [],
      error: error instanceof Error ? error.message : serverT("hostcronLib.readFailed"),
    };
  }
}

export type CronInput = {
  name: string;
  schedule: string;
  user: string;
  command: string;
  comment: string;
  enabled: boolean;
};

const NAME_RE = /^[a-z0-9][a-z0-9-]{0,40}$/;
const USER_RE = /^[a-z_][a-z0-9_-]{0,31}$/;

export function validateCron(input: CronInput): string | null {
  if (!NAME_RE.test(input.name)) {
    // cron.d nokta ve alt çizgi içeren dosya adlarını çalıştırmaz.
    return serverT("hostcronLib.nameFormat");
  }
  if (!USER_RE.test(input.user)) return serverT("hostcronLib.invalidUser");

  const fields = input.schedule.trim().split(/\s+/);
  const isSpecial = fields.length === 1 && SPECIALS.has(fields[0]);
  if (!isSpecial) {
    if (fields.length !== 5) return serverT("hostcronLib.scheduleFields");
    if (!fields.every((field) => /^[\d*,/-]+$/.test(field))) {
      return serverT("hostcronLib.scheduleChars");
    }
  }

  const command = input.command.trim();
  if (command.length === 0) return serverT("hostcronLib.commandEmpty");
  // Yeni satır, dosyaya ikinci bir görev satırı sokmanın yolu olurdu.
  if (/[\n\r]/.test(command)) return serverT("hostcronLib.commandOneLine");

  return null;
}

/** Panelin yazdığı dosyanın içeriği. Başlık, kimin yazdığını açık ediyor. */
function renderFile(input: CronInput): string {
  const lines = [
    serverT("hostcronLib.fileHeader1"),
    serverT("hostcronLib.fileHeader2"),
    "SHELL=/bin/sh",
    "PATH=/usr/local/sbin:/usr/local/bin:/sbin:/bin:/usr/sbin:/usr/bin",
    "",
  ];
  if (input.comment.trim()) lines.push(`# ${input.comment.trim().replace(/[\n\r]/g, " ")}`);

  const entry = `${input.schedule.trim()} ${input.user} ${input.command.trim()}`;
  lines.push(input.enabled ? entry : `# ${entry}`, "");

  return lines.join("\n");
}

export type CronOutcome = { ok: boolean; message: string };

/**
 * Görev dosyasını yazar.
 *
 * `files/write.ts` kullanılmıyor: orası izinli köklerle sınırlı ve `/etc/cron.d`
 * oraya girmiyor (girseydi dosya yöneticisinden de yazılabilir olurdu, ki
 * istenmiyor). Yazma burada, yalnızca bu tek klasöre, kendi container'ıyla.
 */
export async function saveCron(
  input: CronInput,
  actor: { username: string; userId: number },
): Promise<CronOutcome> {
  const problem = validateCron(input);
  if (problem) return { ok: false, message: problem };

  const image = await panelImage();
  if (!image) return { ok: false, message: serverT("stacks.noPanelImage") };

  const fileName = `${PANEL_PREFIX}${input.name}`;

  const result = await getDockerProvider().runThrowaway({
    image,
    // İçerik ENV ile geçiyor, komut satırında değil: komutta tırnak ve boşluk
    // kaçırma sorunları olurdu.
    cmd: [
      "node",
      "-e",
      'require("node:fs").writeFileSync(process.env.TARGET, process.env.CONTENT, { mode: 0o644 });',
    ],
    binds: [`${CRON_D}:/cron`],
    env: { TARGET: `/cron/${fileName}`, CONTENT: renderFile(input) },
    namePrefix: "panel-cron",
    timeoutMs: 60_000,
    user: "0:0",
  });

  const ok = result.exitCode === 0;

  audit({
    userId: actor.userId,
    username: actor.username,
    action: "hostcron.save",
    targetType: "cron",
    targetId: fileName,
    detail: ok ? `${input.schedule} ${input.user} ${input.command}` : result.output.slice(0, 300),
    result: ok ? "ok" : "error",
  });

  return {
    ok,
    message: ok
      ? serverT("hostcronLib.saved", { file: fileName })
      : result.output.slice(0, 400) || serverT("hostcronLib.writeFailed"),
  };
}

export async function deleteCron(
  name: string,
  actor: { username: string; userId: number },
): Promise<CronOutcome> {
  if (!NAME_RE.test(name)) return { ok: false, message: serverT("hostcronLib.invalidName") };

  const image = await panelImage();
  if (!image) return { ok: false, message: serverT("stacks.noPanelImage") };

  const fileName = `${PANEL_PREFIX}${name}`;

  const result = await getDockerProvider().runThrowaway({
    image,
    cmd: [
      "node",
      "-e",
      'require("node:fs").rmSync(process.env.TARGET, { force: true });',
    ],
    binds: [`${CRON_D}:/cron`],
    env: { TARGET: `/cron/${fileName}` },
    namePrefix: "panel-cron",
    timeoutMs: 60_000,
    user: "0:0",
  });

  const ok = result.exitCode === 0;

  audit({
    userId: actor.userId,
    username: actor.username,
    action: "hostcron.delete",
    targetType: "cron",
    targetId: fileName,
    detail: ok ? "silindi" : result.output.slice(0, 300),
    result: ok ? "ok" : "error",
  });

  return { ok, message: ok ? `${fileName} silindi.` : result.output.slice(0, 400) };
}

/** Panelin yönettiği görevin adını dosya yolundan çıkarır. */
export function managedName(source: string): string | null {
  const match = source.match(new RegExp(`^${CRON_D}/${PANEL_PREFIX}(.+)$`));
  return match ? match[1] : null;
}

/** Ayarlardan gelen "bu komutlara izin verilmez" listesi (boşsa sınır yok). */
export function forbiddenCommand(command: string): string | null {
  const patterns = getString("hostcron.forbidden")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry.length > 0);

  const lower = command.toLowerCase();
  for (const pattern of patterns) {
    if (lower.includes(pattern)) return serverT("hostcronLib.forbidden", { pattern });
  }
  return null;
}
