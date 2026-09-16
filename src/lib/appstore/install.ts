import "server-only";

import path from "node:path";

import { audit } from "@/lib/auth/audit";
import { getDb } from "@/lib/db/client";
import { callHelper } from "@/lib/host/helper";
import { panelImage } from "@/lib/host/self";
import { serverT } from "@/lib/i18n/runtime";
import { getDockerProvider } from "@/lib/providers";
import { getString } from "@/lib/settings";

/**
 * Compose yığını kurulumu ve işletimi.
 *
 * Akış: compose dosyasını yaz (root container) → `compose config` ile doğrula →
 * `compose up` (host-helper). Yazma ile çalıştırmanın ayrı olmasının sebebi
 * yeteneklerin farklı olması: dosya yazmak için root bir container yeter,
 * `docker compose` ise bir CLI eklentisi ve host'ta çalışması gerekiyor.
 *
 * KURULUM ASLA MEVCUT BİR DİZİNİN ÜZERİNE YAZMAZ. Bir compose dosyasını
 * sessizce değiştirmek, kullanıcının elle yaptığı düzenlemeleri yok etmek
 * demek olurdu.
 *
 * TARİHÇE: burada M3.10'da bir şablon katalogu (dahili şablonlar + uzak
 * Portainer kaynakları) vardı ve kaldırıldı. Kullanıcının gerçekten yaptığı
 * şey kendi compose dosyasını getirmekti; katalog 475 uygulamaya çıkmasına
 * rağmen kullanılmadı. Kalan boru hattı katalogun zaten kullandığı boru hattı,
 * yalnızca girdisi artık yüklenen dosya.
 */

export type InstalledStack = {
  id: number;
  name: string;
  templateId: string;
  templateName: string;
  directory: string;
  variables: Record<string, string>;
  installedBy: string;
  installedAt: number;
  lastAction: string;
  lastError: string;
};

const NAME_RE = /^[a-z0-9][a-z0-9-]{1,30}$/;

export function stacksRoot(): string {
  return getString("appstore.stacks_dir").replace(/\/+$/, "") || "/opt/stacks";
}

/**
 * Compose dosyasını yazan geçici container'ın uid:gid'i.
 *
 * Varsayılan root: /opt gibi yollara ancak root yazabilir. Ama yığın kök dizini
 * kullanıcının ev dizini olduğunda (izin listesiyle uyuşan en pratik yol)
 * root'un yazması, kullanıcının kendi compose dosyasını SSH'tan sudo'suz
 * düzenleyememesi demek. Bu yüzden ayar.
 */
function fileOwner(): string {
  const raw = getString("appstore.file_owner").trim();
  return /^\d+:\d+$/.test(raw) ? raw : "0:0";
}

/**
 * Host'un izin listesine yazılması gereken satırlar.
 *
 * `compose.down` bir zamanlar BİLEREK yoktu: bir yığını tamamen durdurur ve
 * host-helper'ın kendi kurulum şablonu da onu kapalı öneriyor. Gerekçe iyiydi
 * ama sonucu değildi — panel "yığını kaldır" düğmesini sunuyor ve o düğme bu
 * izin olmadan görevini HİÇBİR ZAMAN yapamıyor. Yaşanmış olay: kullanıcı
 * yığını kaldırdı, panel kaydı sildi, container arkada kaldı, denetim kaydına
 * "eylem izinli değil: compose.down" düştü.
 *
 * Kurulum talimatının, ürünün vaat ettiği işlevi mümkün kılmaması bir
 * tutarsızlıktı. Kapsam yine de dar: desen yalnızca yığın kökü ALTINDAKİ
 * dizinleri kabul ediyor, keyfi bir yolda `compose down` çalıştırılamıyor —
 * ve o kök `compose.up` için zaten açık olmak zorunda.
 */
export function allowLinesFor(root: string): string {
  const pattern = `^${root.replace(/\/+$/, "")}/`;
  return [
    "compose.ps",
    "compose.config",
    "compose.up",
    "compose.down",
    "compose.pull",
    "compose.restart",
  ]
    .map((action) => `${action.padEnd(16)} ${pattern}`)
    .join("\n");
}

export function listStacks(): InstalledStack[] {
  return (
    getDb()
      .prepare(
        `SELECT id, name, template_id, directory, variables, installed_by,
                installed_at, last_action, last_error
         FROM app_stacks ORDER BY name`,
      )
      .all() as Record<string, string | number>[]
  ).map((row) => ({
    id: Number(row.id),
    name: String(row.name),
    templateId: String(row.template_id),
    templateName: describeTemplate(String(row.template_id)),
    directory: String(row.directory),
    variables: parseVars(String(row.variables)),
    installedBy: String(row.installed_by ?? ""),
    installedAt: Number(row.installed_at),
    lastAction: String(row.last_action ?? ""),
    lastError: String(row.last_error ?? ""),
  }));
}

/**
 * Yığının kaynağının okunabilir adı.
 *
 * Katalog kaldırıldığı için eski kayıtların şablon adı artık çözülemiyor; ham
 * kimlik gösteriliyor (`vaultwarden`, `src:2:jellyfin` …). Kurulu ve çalışan
 * bir uygulamayı listeden gizlemek ya da adını uydurmak, panelin yalan
 * söylemesi olurdu.
 */
function describeTemplate(templateId: string): string {
  if (templateId === CUSTOM_TEMPLATE_ID) return serverT("stacks.uploadedCompose");
  return templateId;
}

function parseVars(raw: string): Record<string, string> {
  try {
    return JSON.parse(raw) as Record<string, string>;
  } catch {
    return {};
  }
}

export type InstallOutcome = {
  ok: boolean;
  message: string;
  output?: string;
  /**
   * `docker compose config`'in ÇIKIŞ KODU 0 İKEN yazdığı uyarılar.
   *
   * Compose, tanımsız `${DEĞİŞKEN}` ve kullanımdan kalkmış anahtar uyarılarını
   * stderr'e basar ama başarıyla çıkar. Bu uyarılar bugüne kadar okunup
   * atılıyordu; oysa "parola boş kaldı" gibi sessiz hataların tek erken
   * işareti onlar — `${DB_PASSWORD}` tanımsızsa compose onu boş dizeye çevirir
   * ve servis parolasız açılır.
   */
  warnings?: string;
};

/**
 * host-helper'ın reddini anlaşılır hâle getirir.
 *
 * İzin listesi HOST tarafında ve panel onu okuyamıyor (T4 — okuyabilseydi
 * güvenlik modeli çökerdi). Bu yüzden ret sebebi ancak hata metninden
 * anlaşılıyor ve ham hâliyle ("argüman izin verilen desene uymuyor")
 * kullanıcıya hiçbir şey anlatmıyor.
 */
function explainHelper(error: string, directory: string): string {
  // Eşleşen parçalar host-helper'ın (Python) sabit hata metinleri — çeviri değil protokol.
  if (error.includes("desene uymuyor")) { // i18n-ignore
    return serverT("stacks.helper.patternDenied", {
      directory,
      lines: allowLinesFor(stacksRoot()),
    });
  }
  if (error.includes("izinli değil")) { // i18n-ignore
    const action = error.split(":").pop()?.trim() ?? serverT("stacks.helper.thisAction");
    return serverT("stacks.helper.actionDisabled", { action });
  }
  if (error.includes("bilinmeyen eylem")) { // i18n-ignore
    return serverT("stacks.helper.unknownAction");
  }
  return error;
}

/**
 * Compose dosyasını diske yazar.
 *
 * Dizin oluşturma ve dosya yazma tek script'te. `wx` bayrağı: dosya varsa
 * HATA verir, üzerine yazmaz. Kullanıcının elle düzenlediği bir compose
 * dosyasını sessizce değiştirmek en kötü sonuç olurdu.
 */
async function writeCompose(
  name: string,
  compose: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const image = await panelImage();
  if (!image) return { ok: false, message: serverT("stacks.noPanelImage") };

  const result = await getDockerProvider().runThrowaway({
    image,
    cmd: [
      "node",
      "-e",
      'const fs=require("node:fs");' +
        'fs.mkdirSync(process.env.DIR,{recursive:true});' +
        'fs.writeFileSync(process.env.DIR+"/docker-compose.yml",process.env.COMPOSE,{flag:"wx"});',
    ],
    // Yığın kök dizini bağlanıyor, "/" değil: kurulum yalnızca kendi
    // alanına yazabilsin.
    binds: [`${stacksRoot()}:/stacks`],
    env: {
      DIR: path.posix.join("/stacks", name),
      COMPOSE: compose,
    },
    namePrefix: "panel-stack",
    timeoutMs: 60_000,
    user: fileOwner(),
  });

  if (result.exitCode === 0) return { ok: true };

  const directory = path.posix.join(stacksRoot(), name);
  if (result.output.includes("EEXIST")) {
    return {
      ok: false,
      message: serverT("stacks.exists", { directory }),
    };
  }
  if (result.output.includes("EACCES") || result.output.includes("EPERM")) {
    return {
      ok: false,
      message: serverT("stacks.writeDenied", { directory, owner: fileOwner() }),
    };
  }
  return { ok: false, message: result.output.slice(0, 400) || serverT("stacks.writeFailed") };
}

/**
 * Panelden kurulan yığınların `template_id` değeri.
 *
 * Sütun katalog döneminden kalma ve şablon adı tutuyordu; artık tek bir kaynak
 * var. Sabit "custom" olarak korunuyor çünkü veritabanında kayıtlı değerlerle
 * uyuşması gerekiyor.
 */
export const CUSTOM_TEMPLATE_ID = "custom";

export const MAX_COMPOSE_BYTES = 256 * 1024;

/**
 * Compose dosyasından yığın kurmanın tek yolu.
 *
 * Akış:
 *
 *   dosyayı yaz (wx) → compose.config → compose.up
 *
 * `compose.config` YAML'ı çözümleyip basar, hiçbir şey başlatmaz. Bozuk bir
 * dosyayı doğrudan `up` ile denemek, kullanıcıya docker'ın yarım kalmış bir
 * hatasını göstermek olurdu; burada hata YAML'ın kendisiyle birlikte geliyor.
 */
export async function installComposeStack(
  input: { name: string; compose: string },
  actor: { username: string; userId: number },
): Promise<InstallOutcome> {
  const name = input.name.trim();
  const compose = input.compose.replace(/\r\n/g, "\n");

  if (!NAME_RE.test(name)) {
    return { ok: false, message: serverT("stacks.invalidName") };
  }
  if (compose.trim().length === 0) {
    return { ok: false, message: serverT("stacks.emptyCompose") };
  }
  if (Buffer.byteLength(compose, "utf8") > MAX_COMPOSE_BYTES) {
    return { ok: false, message: serverT("stacks.tooLarge") };
  }

  /*
    Ad çakışmasında BAŞARISIZ kurulumu ayırmak gerekiyor.

    Yaşanmış çıkmaz: `compose up` host tarafından reddedildi, ama compose
    dosyası diskte ve kayıt veritabanında kaldı. Aynı adla tekrar denemek
    "zaten kurulu" diyordu — oysa kurulu değildi, ve kullanıcıya panelden
    çıkış yolu görünmüyordu. Sonuç: uygulamayı elle kurmak zorunda kaldı.
  */
  const clash = listStacks().find((stack) => stack.name === name);
  if (clash) {
    return {
      ok: false,
      message: clash.lastError
        ? serverT("stacks.failedLeftover", { name, error: clash.lastError.slice(0, 120) })
        : serverT("stacks.alreadyInstalled", { name }),
    };
  }

  const directory = path.posix.join(stacksRoot(), name);

  const write = await writeCompose(name, compose);
  if (!write.ok) return { ok: false, message: write.message };

  const record = (action: string, error: string) =>
    getDb()
      .prepare(
        `INSERT INTO app_stacks (name, template_id, directory, variables, installed_by, last_action, last_error)
         VALUES (?, ?, ?, '{}', ?, ?, ?)`,
      )
      .run(name, CUSTOM_TEMPLATE_ID, directory, actor.username, action, error.slice(0, 500));

  // Doğrulama adımı. Geçersizse `up` HİÇ çalıştırılmıyor.
  const check = await callHelper("compose.config", { dir: directory }, actor);
  if (check.exitCode !== undefined && check.exitCode !== 0) {
    const detail = (check.stderr ?? check.stdout ?? "").slice(0, 600);

    // Kayıt YİNE DE açılıyor. Dosya diskte duruyor ve kullanıcıya "listeden
    // Tekrar dene" deniyor — listede olmayan bir şey için bunu söylemek,
    // panelin yapmadığı bir şeyi vaat etmesi olurdu.
    record(serverT("stacks.action.invalid"), detail);

    audit({
      userId: actor.userId,
      username: actor.username,
      action: "appstore.install",
      targetType: "stack",
      targetId: name,
      detail: serverT("stacks.audit.validationFailed"),
      result: "error",
    });

    return {
      ok: false,
      message: serverT("stacks.invalidCompose", { directory, detail }),
    };
  }
  // `exitCode` yoksa helper reddetmiştir; doğrulamayı ATLAYIP `up`'a devam
  // ediyoruz. `compose.config` kapalı ama `compose.up` açık olabilir ve
  // sınayamadığımız bir şey yüzünden kurulumu engellemek yanlış olurdu.

  // Doğrulama GEÇSE BİLE stderr dolu olabilir; orası uyarıların yeri.
  const warnings = (check.stderr ?? "").trim().slice(0, 600);

  const up = await callHelper("compose.up", { dir: directory }, actor);
  const ok = up.ok && (up.exitCode ?? 1) === 0;

  record(
    ok ? serverT("stacks.action.installed") : serverT("stacks.action.installError"),
    ok ? "" : (up.stderr ?? up.error ?? ""),
  );

  audit({
    userId: actor.userId,
    username: actor.username,
    action: "appstore.install",
    targetType: "stack",
    targetId: name,
    detail: ok
      ? serverT("stacks.audit.ownCompose", { directory })
      : (up.error ?? serverT("stacks.audit.upFailed")),
    result: ok ? "ok" : "error",
  });

  return {
    ok,
    message: ok
      ? serverT("stacks.installed", { name, directory })
      : serverT("stacks.writtenNotStarted", {
          directory,
          reason: explainHelper(up.error ?? up.stderr ?? "", directory),
        }),
    output: (up.stdout ?? "") + (up.stderr ?? ""),
    warnings,
  };
}

export type StackAction = "up" | "down" | "restart" | "pull";

export async function stackAction(
  name: string,
  action: StackAction,
  actor: { username: string; userId: number },
): Promise<InstallOutcome> {
  const stack = listStacks().find((entry) => entry.name === name);
  if (!stack) return { ok: false, message: serverT("stacks.notFound") };

  const helperAction = (
    { up: "compose.up", down: "compose.down", restart: "compose.restart", pull: "compose.pull" } as const
  )[action];

  const response = await callHelper(helperAction, { dir: stack.directory }, actor);
  const ok = response.ok && (response.exitCode ?? 1) === 0;

  getDb()
    .prepare("UPDATE app_stacks SET last_action = ?, last_error = ? WHERE name = ?")
    .run(action, ok ? "" : (response.error ?? response.stderr ?? "").slice(0, 500), name);

  audit({
    userId: actor.userId,
    username: actor.username,
    action: `appstore.${action}`,
    targetType: "stack",
    targetId: name,
    detail: ok ? "ok" : (response.error ?? serverT("stacks.audit.failed")),
    result: ok ? "ok" : "error",
  });

  return {
    ok,
    message: ok
      ? serverT("stacks.actionDone", { name, action })
      : explainHelper(
          response.error ?? response.stderr ?? serverT("common.errors.actionFailed"),
          stack.directory,
        ),
    output: (response.stdout ?? "") + (response.stderr ?? ""),
  };
}

/**
 * Yığın KAYDINI siler. Dosyalar ve veri diskte kalır.
 *
 * `compose down` çağrılıyor ama `-v` YOK: volume silmek veri silmektir ve
 * bir "kaldır" düğmesinin arkasına saklanmamalı. Kullanıcı veriyi de silmek
 * isterse dizini dosya yöneticisinden kaldırır ve ne yaptığını bilir.
 */
export async function removeStack(
  name: string,
  actor: { username: string; userId: number },
): Promise<InstallOutcome> {
  const stack = listStacks().find((entry) => entry.name === name);
  if (!stack) return { ok: false, message: serverT("stacks.notFound") };

  const response = await callHelper("compose.down", { dir: stack.directory }, actor);
  const stopped = response.ok && (response.exitCode ?? 1) === 0;

  // Kayıt her hâlükârda siliniyor: kullanıcı "bu artık benim listemde olmasın"
  // dedi. Ama container'lar durmadıysa BUNU SÖYLEMEK zorundayız — "kaldırıldı"
  // deyip arkada çalışmaya devam etmesi, en kötü türden sessiz yalan olurdu.
  getDb().prepare("DELETE FROM app_stacks WHERE name = ?").run(name);

  audit({
    userId: actor.userId,
    username: actor.username,
    action: "appstore.remove",
    targetType: "stack",
    targetId: name,
    detail: stopped
      ? serverT("stacks.audit.removed", { directory: stack.directory })
      : serverT("stacks.audit.removedNotStopped", { error: response.error ?? "?" }),
    result: stopped ? "ok" : "error",
  });

  return {
    ok: true,
    message: stopped
      ? serverT("stacks.removed", { name, directory: stack.directory })
      : serverT("stacks.removedStillRunning", {
          name,
          directory: stack.directory,
          reason: explainHelper(response.error ?? "", stack.directory),
        }),
    output: (response.stdout ?? "") + (response.stderr ?? ""),
  };
}
