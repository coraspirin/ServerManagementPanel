import "server-only";

import { existsSync, statSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { dataDir } from "@/lib/db/client";
import { appVersion, isMockMode } from "@/lib/env";
import { panelContainerName } from "@/lib/host/self";
import { LOCAL_HOST_ID } from "@/lib/hosts/context";
import { serverT } from "@/lib/i18n/runtime";
import { providersFor } from "@/lib/providers";
import {
  IMAGE_UPDATER_SCRIPT,
  UPDATER_SCRIPT,
  compareTags,
  formatStateLine,
  isReleaseTag,
  isRepoName,
  parseStateLine,
  pickLatestTag,
  releaseImageRef,
  type UpdatePhase,
} from "./plan";

/**
 * Panelin kendini GitHub'daki bir sürüm etiketinden güncellemesi.
 *
 * Akış: panel sürüm arşivini (`codeload.github.com`) veri dizinine indirir,
 * sonra docker.sock üzerinden ayrı bir updater container'ı başlatır. Panel
 * kendi container'ı yeniden yaratılırken ölür; updater ayakta kalır, işi
 * bitirir ve sonucu veri volume'üne yazar. Yeni panel açılınca sonucu okur.
 *
 * Yeni bir yetki açılmıyor: docker.sock zaten host'ta root demek. host-helper
 * bilinçli olarak panele kendini yeniden yaratma yolu vermiyor — bu yol onu
 * kullanmıyor, onun izin listesini de genişletmiyor.
 *
 * Her zaman YEREL sunucu: üst barda uzak sunucu seçili olsa da güncellenen,
 * bu isteği karşılayan paneldir.
 */

const DEFAULT_REPO = "coraspirin/ServerManagementPanel";
const DEFAULT_UPDATER_IMAGE = "docker:27-cli";
const CHECK_CACHE_MS = 30 * 60_000;
const MAX_ARCHIVE_BYTES = 200 * 1024 * 1024;
const LOG_TAIL_LINES = 200;
const HOST_ROOT = process.env.HOST_ROOT ?? "/host/root";

function repo(): string {
  const value = process.env.PANEL_UPDATE_REPO?.trim() || DEFAULT_REPO;
  return isRepoName(value) ? value : DEFAULT_REPO;
}

function updaterImage(): string {
  return process.env.PANEL_UPDATER_IMAGE?.trim() || DEFAULT_UPDATER_IMAGE;
}

function updatesDir(): string {
  return path.join(/*turbopackIgnore: true*/ dataDir(), "updates");
}

function updaterName(): string {
  return `${panelContainerName()}-updater`;
}

function docker() {
  return providersFor(LOCAL_HOST_ID).docker;
}

// --- sürüm kontrolü ---------------------------------------------------------

export type UpdateCheck = {
  current: string;
  repo: string;
  latest: string | null;
  newer: boolean;
  compareUrl: string | null;
  checkedAt: number;
  error: string | null;
};

let checkCache: UpdateCheck | null = null;

export async function checkForUpdate(force = false): Promise<UpdateCheck> {
  if (!force && checkCache && Date.now() - checkCache.checkedAt < CHECK_CACHE_MS) {
    return checkCache;
  }

  const current = appVersion();
  const source = repo();
  let latest: string | null = null;
  let error: string | null = null;

  if (isMockMode()) {
    const [major, minor] = current.split(".").map(Number);
    latest = `v${major}.${(minor || 0) + 1}.0`;
  } else {
    try {
      const response = await fetch(`https://api.github.com/repos/${source}/tags?per_page=100`, {
        headers: { accept: "application/vnd.github+json", "user-agent": "server-panel" },
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const tags = (await response.json()) as { name?: unknown }[];
      latest = pickLatestTag(tags.map((tag) => String(tag.name ?? "")));
    } catch (cause) {
      error = serverT("selfUpdate.errors.check", {
        error: cause instanceof Error ? cause.message : String(cause),
      });
    }
  }

  const newer = latest !== null && compareTags(latest, current) > 0;
  checkCache = {
    current,
    repo: source,
    latest,
    newer,
    compareUrl: newer ? `https://github.com/${source}/compare/v${current}...${latest}` : null,
    checkedAt: Date.now(),
    error,
  };
  return checkCache;
}

// --- durum -------------------------------------------------------------------

export type UpdateStatus = {
  phase: UpdatePhase;
  tag: string | null;
  detail: string | null;
  at: number | null;
  log: string[];
};

async function readText(file: string): Promise<string> {
  try {
    return await readFile(file, "utf8");
  } catch {
    return "";
  }
}

/**
 * Durum dosyasını ve günlüğün sonunu okur. "Sürüyor" diyen bir durum dosyası
 * ama durmuş bir updater, betiğin yarıda öldüğü demek (ör. host yeniden
 * başladı) — sonsuza dek "sürüyor" göstermek yerine başarısız sayılır.
 */
export async function updateStatus(): Promise<UpdateStatus> {
  const state = parseStateLine(await readText(path.join(updatesDir(), "state")));
  const log = (await readText(path.join(updatesDir(), "update.log")))
    .split("\n")
    .filter((line) => line.length > 0)
    .slice(-LOG_TAIL_LINES);

  let { phase, detail } = state;
  if (phase === "running" && !isMockMode() && !(await updaterRunning())) {
    phase = "failed";
    detail = serverT("selfUpdate.errors.updaterStopped");
  }

  return { phase, tag: state.tag, detail, at: state.at || null, log };
}

async function updaterRunning(): Promise<boolean> {
  try {
    const state = await docker().inspect(updaterName());
    // Az önce yaratılmış ve henüz başlamamış container da "sürüyor" sayılır.
    return state !== null && (state.running || state.status === "created");
  } catch {
    return true;
  }
}

// --- başlatma ----------------------------------------------------------------

type PanelContainer = {
  Config?: { Image?: string; Labels?: Record<string, string> };
  Mounts?: { Type?: string; Name?: string; Source?: string; Destination?: string }[];
};

async function writeState(phase: UpdatePhase, tag: string, detail?: string) {
  const file = path.join(updatesDir(), "state");
  // Önce silinir: betik dosyayı root olarak yaratıyor, panel (uid 1001) onu
  // yerinde yazamaz ama dizin kendisinin olduğu için silebilir.
  await rm(file, { force: true });
  await writeFile(file, formatStateLine(Math.floor(Date.now() / 1000), phase, tag, detail));
}

async function resetLog(firstLine: string) {
  const file = path.join(updatesDir(), "update.log");
  await rm(file, { force: true });
  await writeFile(file, `${firstLine}\n`);
}

async function download(tag: string): Promise<string> {
  const target = path.join(updatesDir(), `${tag}.tar.gz`);
  const response = await fetch(`https://codeload.github.com/${repo()}/tar.gz/refs/tags/${tag}`, {
    headers: { "user-agent": "server-panel" },
    signal: AbortSignal.timeout(5 * 60_000),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);

  const declared = Number(response.headers.get("content-length") ?? 0);
  if (declared > MAX_ARCHIVE_BYTES) throw new Error(`${declared} B`);
  const body = Buffer.from(await response.arrayBuffer());
  if (body.length > MAX_ARCHIVE_BYTES) throw new Error(`${body.length} B`);
  // gzip imzası: GitHub bir hata sayfası döndürdüyse betiğe hiç gitmesin.
  if (body[0] !== 0x1f || body[1] !== 0x8b) throw new Error("not a gzip archive");

  await rm(target, { force: true });
  await writeFile(target, body);
  return target;
}

/**
 * Proje dizininde Dockerfile var mı: true/false, anlaşılamıyorsa null.
 *
 * `existsSync` izin hatasında da false döner. Panel uid 1001 ile çalışıyor ve
 * proje çoğunlukla 750 izinli bir ev dizininin altında: Dockerfile varken
 * "yok" denip güncelleme reddediliyordu. Bilinmeyen durumda karar imaj adına
 * bırakılır; updater betiği arşivi açarken zaten kendi denetimini yapıyor.
 */
function dockerfilePresent(workdir: string): boolean | null {
  if (!existsSync(/*turbopackIgnore: true*/ HOST_ROOT)) return null;
  try {
    statSync(/*turbopackIgnore: true*/ path.join(HOST_ROOT, workdir, "Dockerfile"));
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ENOENT" ? false : null;
  }
}

function stamp(): string {
  return new Date().toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 13);
}

/** Güncellemeyi başlatır; hata kullanıcıya gösterilecek metinle fırlar. */
export async function startUpdate(tag: string): Promise<void> {
  if (!isReleaseTag(tag)) throw new Error(serverT("selfUpdate.errors.badTag", { tag }));

  const current = appVersion();
  if (compareTags(tag, current) <= 0) {
    throw new Error(serverT("selfUpdate.errors.notNewer", { tag, current }));
  }

  const status = await updateStatus();
  if (status.phase === "running") throw new Error(serverT("selfUpdate.errors.running"));

  await mkdir(updatesDir(), { recursive: true });

  if (isMockMode()) {
    simulate(tag);
    return;
  }

  const provider = docker();
  const self = (await provider.inspectRaw(panelContainerName())) as PanelContainer | null;
  const labels = self?.Config?.Labels ?? {};
  const project = labels["com.docker.compose.project"];
  const workdir = labels["com.docker.compose.project.working_dir"];
  const service = labels["com.docker.compose.service"];
  if (!project || !workdir || !service || !path.posix.isAbsolute(workdir)) {
    throw new Error(serverT("selfUpdate.errors.notCompose"));
  }

  // İki kurulum biçimi var:
  //  - kaynaktan derleme (`git clone` + `build:`): sürüm arşivi indirilir,
  //    dosyalar değiştirilip imaj yeniden derlenir;
  //  - hazır imaj (`image: ghcr.io/…`, dizinde Dockerfile yok): yeni sürümün
  //    imajı çekilir ve container onunla yeniden yaratılır.
  // Host kökü bağlıysa Dockerfile'a bakılır; bağlı değilse imaj adından
  // karar verilir (kayıt defteri adı olmayan imaj yerel derlemedir).
  const panelImageRef = self?.Config?.Image ?? "";
  const hasDockerfile =
    dockerfilePresent(workdir) ?? !panelImageRef.includes("/");
  const newImage = hasDockerfile ? null : releaseImageRef(panelImageRef, tag);
  if (!hasDockerfile && !newImage) {
    throw new Error(serverT("selfUpdate.errors.notSource", { dir: workdir }));
  }

  const dataMount = self?.Mounts?.find((mount) => mount.Destination === "/app/data");
  const dataSource = dataMount?.Type === "volume" ? dataMount.Name : dataMount?.Source;
  if (!dataSource) throw new Error(serverT("selfUpdate.errors.noData"));
  const socket =
    self?.Mounts?.find((mount) => mount.Destination === "/var/run/docker.sock")?.Source ??
    "/var/run/docker.sock";

  if (hasDockerfile) {
    try {
      await download(tag);
    } catch (cause) {
      throw new Error(
        serverT("selfUpdate.errors.download", {
          error: cause instanceof Error ? cause.message : String(cause),
        }),
      );
    }
  }

  const name = updaterName();
  try {
    await provider.removeContainer(name, true);
  } catch {
    // Önceki updater yoksa sorun değil.
  }

  const configFiles = labels["com.docker.compose.project.config_files"];
  const env: Record<string, string> = {
    TAG: tag,
    WORKDIR: workdir,
    PROJECT: project,
    SERVICE: service,
    PANEL_CONTAINER: panelContainerName(),
    PANEL_IMAGE: panelImageRef,
    STAMP: stamp(),
    ...(newImage ? { NEW_IMAGE: newImage, OLD_VERSION: current } : {}),
    ...(configFiles ? { COMPOSE_FILE: configFiles.split(",").join(":") } : {}),
  };

  const payload = {
    Image: updaterImage(),
    Cmd: ["sh", "-c", newImage ? IMAGE_UPDATER_SCRIPT : UPDATER_SCRIPT],
    Env: Object.entries(env).map(([key, value]) => `${key}=${value}`),
    Labels: { "server-panel.role": "updater" },
    User: "0:0",
    HostConfig: {
      Binds: [
        `${socket}:/var/run/docker.sock`,
        // Aynı yol: compose'un göreli bind'leri (./Caddyfile) host yolu olarak çözülsün.
        `${workdir}:${workdir}`,
        `${dataSource}:/panel-data`,
      ],
      AutoRemove: false,
      RestartPolicy: { Name: "no" },
    },
  };

  await resetLog(`==> ${current} -> ${tag}`);
  await writeState("running", tag, "start");

  try {
    let id: string;
    try {
      id = await provider.createContainer(name, payload);
    } catch {
      // İmaj yerelde yok: bir kez indirilip yeniden denenir.
      const progress = provider.pullImage(updaterImage());
      while (!(await progress.next()).done) {
        /* ilerleme yok sayılıyor */
      }
      id = await provider.createContainer(name, payload);
    }
    await provider.action(id, "start", 10);
  } catch (cause) {
    const message = serverT("selfUpdate.errors.start", {
      error: cause instanceof Error ? cause.message : String(cause),
    });
    await writeState("failed", tag, "start");
    throw new Error(message);
  }
}

/** Mock mod: arayüzü denemek için sahte ilerleme, hiçbir şey değişmez. */
function simulate(tag: string) {
  const steps = ["extract", "backup", "files", "build", "health", "done"];
  void resetLog(`==> ${appVersion()} -> ${tag} (mock)`).then(() => writeState("running", tag, "start"));
  steps.forEach((step, index) => {
    setTimeout(() => {
      const file = path.join(updatesDir(), "update.log");
      void readText(file).then((text) => writeFile(file, `${text}==> ${step}\n`));
      if (step === "done") void writeState("done", tag);
      else void writeState("running", tag, step);
    }, (index + 1) * 1500);
  });
}
