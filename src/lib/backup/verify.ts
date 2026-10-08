import "server-only";

import { announce } from "@/lib/alerts/announce";
import { currentHostId } from "@/lib/hosts/context";
import { serverT } from "@/lib/i18n/runtime";
import { initialProgress, jobLabel, refreshRepoStats, tagFor } from "./engine";
import { finishLiveRun, registerRun, updateRun } from "./live";
import { repoKey, withRepoLock } from "./queue";
import { looksUninitialized, parseResticLine, parseSnapshots, restoreArgs } from "./restic";
import { resticRun, resticStream } from "./runner";
import { listJobs } from "./store/jobs";
import { markRepoChecked, markRepoVerified, repoSecrets, type RepoSecrets } from "./store/repos";
import { finishRun, startRun } from "./store/runs";
import type { BackupJob } from "./types";

/**
 * Otomatik geri yükleme testi (konum başına, varsayılan ayda bir).
 *
 *   1. `restic check --read-data-subset` — depodaki verinin bir bölümü
 *      okunup şifreleme/özet doğrulamasından geçirilir.
 *   2. Her işin SON snapshot'ından rastgele dosyalar gerçekten geri açılır
 *      (geçici container'ın içine; host'a hiçbir şey yazılmaz). restic geri
 *      açarken her parçanın özetini doğrular.
 *
 * "Yedek var ama açılmıyor" durumunu ancak bu yakalar.
 */

const SAMPLE_FILES = 10;
const SAMPLE_MAX_BYTES = 50 * 1024 * 1024;
const CHECK_SUBSET = "2%";

export async function verifyRepo(repoId: number, actor: string): Promise<{ ok: boolean; detail: string }> {
  const repo = repoSecrets(repoId);
  if (!repo) return { ok: false, detail: serverT("api.backup.repoPasswordMaster") };
  const hostId = currentHostId();
  const jobs = listJobs().filter((job) => job.repoId === repoId);

  return withRepoLock(repoKey(hostId, repo.id), async () => {
    const parts: string[] = [];
    let ok = true;

    const check = await resticRun(repo, ["check", `--read-data-subset=${CHECK_SUBSET}`], {
      lowPriority: true,
      namePrefix: "panel-restic-verify",
    });
    if (check.exitCode === 0) {
      parts.push(serverT("backupVerify.checkOk", { subset: CHECK_SUBSET }));
      markRepoChecked(repo.id, true, "");
    } else {
      ok = false;
      parts.push(serverT("backupVerify.checkFailed", { output: check.output.trim().slice(-400) }));
    }

    for (const job of jobs) {
      const outcome = await sampleRestore(repo, job, actor, hostId);
      if (outcome) {
        parts.push(`${jobLabel(job)}: ${outcome.detail}`);
        if (!outcome.ok) ok = false;
      }
    }

    const detail = parts.join(" · ");
    markRepoVerified(repo.id, ok ? "ok" : "error", detail);
    await refreshRepoStats(repo).catch(() => undefined);

    if (!ok) {
      await announce({
        alertKey: `backup.verify.${repo.id}`,
        source: "system",
        severity: "critical",
        title: serverT("backupVerify.failedTitle", { repo: repo.name }),
        detail,
      });
    }
    return { ok, detail };
  });
}

async function sampleRestore(
  repo: RepoSecrets,
  job: BackupJob,
  actor: string,
  hostId: number,
): Promise<{ ok: boolean; detail: string } | null> {
  const listing = await resticRun(repo, ["snapshots", "--json", "--tag", tagFor(job, hostId), "--latest", "1"], {
    namePrefix: "panel-restic-snapshots",
  });
  const latest = parseSnapshots(listing.stdout ?? listing.output)[0];
  if (!latest) return null;

  const runId = startRun(job.id, "verify", actor);
  const signal = registerRun(hostId, { ...initialProgress(runId, job.id, job.category, "verify"), phase: "verifying" });
  const startedAt = Date.now();

  try {
    // Dosya listesi akışla okunuyor; milyonlarca satır belleğe alınmıyor —
    // yalnızca rezervuar örneği tutuluyor.
    const sample: { path: string; size: number }[] = [];
    let seen = 0;
    const ls = await resticStream(repo, ["ls", latest.id, "--json", "--recursive"], {
      signal,
      namePrefix: "panel-restic-ls",
      lowPriority: true,
      onLine: (line) => {
        if (!line.startsWith("{")) return;
        try {
          const node = JSON.parse(line) as { struct_type?: string; message_type?: string; type?: string; path?: string; size?: number };
          if ((node.struct_type ?? node.message_type) !== "node" || node.type !== "file" || !node.path) return;
          const size = Number(node.size ?? 0);
          if (size <= 0 || size > SAMPLE_MAX_BYTES) return;
          seen += 1;
          if (sample.length < SAMPLE_FILES) sample.push({ path: node.path, size });
          else {
            const index = Math.floor(Math.random() * seen);
            if (index < SAMPLE_FILES) sample[index] = { path: node.path, size };
          }
        } catch {
          // JSON olmayan satır.
        }
      },
    });
    if (ls.exitCode !== 0) throw new Error(ls.tail.slice(-5).join("\n") || "restic ls");
    if (sample.length === 0) {
      const detail = serverT("backupVerify.noFiles");
      finishRun(runId, { status: "ok", snapshotId: latest.id, durationMs: Date.now() - startedAt, detail });
      finishLiveRun(runId, { status: "ok", message: detail });
      return { ok: true, detail };
    }

    const expected = sample.reduce((total, entry) => total + entry.size, 0);
    let restoredBytes = 0;
    // Hedef bağlanmıyor: dosyalar geçici container'ın kendi diskine açılıp
    // container'la birlikte siliniyor.
    const restore = await resticStream(
      repo,
      restoreArgs(latest.id, sample.map((entry) => entry.path), { target: "/tmp/verify" }),
      {
        signal,
        namePrefix: "panel-restic-verify",
        onLine: (line) => {
          const parsed = parseResticLine(line);
          if (parsed.type === "status") {
            restoredBytes = Math.max(restoredBytes, parsed.progress.bytesDone);
            updateRun(runId, { percent: parsed.progress.percent, bytesDone: parsed.progress.bytesDone, totalBytes: expected });
          }
        },
      },
    );
    const ok = restore.exitCode === 0;
    const detail = ok
      ? serverT("backupVerify.sampleOk", { count: sample.length, snapshot: latest.shortId })
      : serverT("backupVerify.sampleFailed", { output: restore.tail.slice(-5).join(" ").slice(0, 300) });
    finishRun(runId, {
      status: ok ? "ok" : "error",
      snapshotId: latest.id,
      filesTotal: sample.length,
      bytesProcessed: expected,
      durationMs: Date.now() - startedAt,
      detail,
      log: restore.tail.join("\n"),
    });
    finishLiveRun(runId, { status: ok ? "ok" : "error", message: detail, percent: 100 });
    return { ok, detail };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    finishRun(runId, { status: "error", snapshotId: latest.id, durationMs: Date.now() - startedAt, detail });
    finishLiveRun(runId, { status: "error", message: detail });
    return { ok: false, detail };
  }
}

/** Bayat kilidi kaldırır (çöken bir koşudan kalan). */
export async function unlockRepo(repoId: number): Promise<{ ok: boolean; message: string }> {
  const repo = repoSecrets(repoId);
  if (!repo) return { ok: false, message: serverT("api.backup.repoPasswordMaster") };
  const result = await resticRun(repo, ["unlock"], { namePrefix: "panel-restic-unlock" });
  return { ok: result.exitCode === 0, message: result.output.trim().slice(0, 500) };
}

/** Konuma erişim sınaması: depo yoksa "hazır, ilk yedekte oluşturulacak". */
export async function testRepo(repoId: number): Promise<{ ok: boolean; initialized: boolean; message: string }> {
  const repo = repoSecrets(repoId);
  if (!repo) return { ok: false, initialized: false, message: serverT("api.backup.repoPasswordMaster") };
  const result = await resticRun(repo, ["cat", "config"], { namePrefix: "panel-restic-check" });
  if (result.exitCode === 0) {
    markRepoChecked(repo.id, true, "");
    await refreshRepoStats(repo).catch(() => undefined);
    return { ok: true, initialized: true, message: serverT("backupVerify.repoReady") };
  }
  if (looksUninitialized(result.output, result.exitCode)) {
    // Konuma erişilebiliyor mu? init'i sınama sırasında yapmıyoruz — kullanıcı
    // yanlış yolu seçtiyse orada boş bir depo bırakmak istemeyiz.
    markRepoChecked(repo.id, false, "");
    return { ok: true, initialized: false, message: serverT("backupVerify.repoEmpty") };
  }
  const message = result.output.trim().slice(0, 500);
  markRepoChecked(repo.id, false, message);
  return { ok: false, initialized: false, message };
}
