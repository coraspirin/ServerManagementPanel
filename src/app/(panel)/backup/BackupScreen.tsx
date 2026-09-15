"use client";

import { useEffect, useState } from "react";
import {
  AlertTriangle,
  Archive,
  CheckCircle2,
  Database,
  FolderTree,
  HardDrive,
  History,
  Play,
  Plus,
  RotateCcw,
  Trash2,
  XCircle,
} from "lucide-react";
import { Modal } from "@/components/Modal";
import { CronEditor } from "@/components/settings/CronEditor";
import { CSRF_COOKIE, CSRF_HEADER } from "@/lib/auth/types";
import {
  REPO_LABEL,
  SOURCE_LABEL,
  type BackupJob,
  type BackupRepo,
  type BackupRun,
  type Snapshot,
  type SourceKind,
} from "@/lib/backup/types";

/**
 * M3.4 — yedekleme motoru arayüzü.
 *
 * Ekranın taşıdığı en önemli mesaj teknik değil: **depo parolası panelin
 * dışında da saklanmalı.** Panel onu MASTER_KEY ile şifreliyor; anahtar
 * kaybolursa panel parolayı çözemez ve yedekler panel üzerinden okunamaz.
 * restic deposu panelsiz de açılabilir — yeter ki parola elde olsun.
 */

type Payload = { repos: BackupRepo[]; jobs: BackupJob[]; runs: BackupRun[] };

function readCsrfToken(): string {
  const match = document.cookie.match(new RegExp(`(?:^|; )${CSRF_COOKIE}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : "";
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[index]}`;
}

function when(ts: number | null): string {
  return ts === null ? "hiç" : new Date(ts * 1000).toLocaleString("tr-TR");
}

const SOURCE_ICON: Record<SourceKind, typeof Database> = {
  volume: HardDrive,
  host_dir: FolderTree,
  panel_db: Database,
};

const inputClass =
  "mt-1 w-full rounded-md border border-line bg-canvas px-3 py-1.5 text-sm outline-none focus:border-brand";

export function BackupScreen({
  initial,
  volumes,
  containers,
}: {
  initial: Payload;
  volumes: string[];
  containers: string[];
}) {
  const [data, setData] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [repoDraft, setRepoDraft] = useState<Partial<BackupRepo> & { password?: string; env?: string } | null>(null);
  const [jobDraft, setJobDraft] = useState<Partial<BackupJob> | null>(null);
  const [snapshotsFor, setSnapshotsFor] = useState<BackupJob | null>(null);

  async function call(path: string, method: string, body?: unknown): Promise<boolean> {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(path, {
        method,
        headers: { "content-type": "application/json", [CSRF_HEADER]: readCsrfToken() },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const payload = (await response.json()) as Record<string, unknown>;

      if (payload.repos) {
        setData({
          repos: payload.repos as BackupRepo[],
          jobs: payload.jobs as BackupJob[],
          runs: (payload.runs as BackupRun[]) ?? data.runs,
        });
      }
      if (!response.ok) {
        setError(String(payload.error ?? "İşlem başarısız."));
        return false;
      }
      if (payload.message) setNotice(String(payload.message));
      // `ok: false` HTTP 200 ile de gelebilir: yedekleme çalıştı ama başarısız
      // oldu. Bu bir istek hatası değil, bir sonuç.
      if (payload.ok === false) {
        setError(String(payload.message ?? "Başarısız."));
        return false;
      }
      return true;
    } catch {
      setError("Sunucuya ulaşılamadı.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  const unreadable = data.repos.filter((repo) => repo.hasPassword && !repo.passwordReadable);

  return (
    <div className="space-y-5">
      {unreadable.length > 0 && (
        <p className="rounded-lg bg-danger/10 px-4 py-3 text-sm text-danger">
          <strong>{unreadable.map((repo) => repo.name).join(", ")}</strong> deposunun parolası
          çözülemiyor: MASTER_KEY, parola kaydedildiğindekinden farklı. Bu depoya yedek
          alınamaz ve geri yükleme yapılamaz. Parolayı biliyorsan depoyu düzenleyip yeniden gir.
        </p>
      )}
      {error && (
        <p role="alert" className="rounded-lg bg-danger/10 px-4 py-2.5 text-sm text-danger">
          {error}
        </p>
      )}
      {notice && (
        <p className="rounded-lg bg-ok/10 px-4 py-2.5 text-sm text-ok">{notice}</p>
      )}

      {/* --- Depolar --- */}
      <section className="rounded-lg border border-line bg-surface">
        <div className="flex items-center justify-between border-b border-line px-5 py-3">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <Archive className="size-4 text-subtle" aria-hidden />
            Depolar
            <span className="font-normal text-subtle">{data.repos.length}</span>
          </h2>
          <button
            type="button"
            onClick={() => setRepoDraft({ kind: "local", name: "", location: "", password: "", env: "" })}
            className="flex items-center gap-1.5 rounded-md border border-line px-3 py-1.5 text-sm transition-colors hover:border-brand"
          >
            <Plus className="size-4" /> Depo ekle
          </button>
        </div>

        {data.repos.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-subtle">
            Henüz depo yok. Yedeklerin nereye yazılacağını tanımlayarak başla.
          </p>
        ) : (
          <ul className="divide-y divide-line">
            {data.repos.map((repo) => (
              <li key={repo.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
                    {repo.name}
                    <span className="rounded border border-line px-1 text-[10px] font-normal text-subtle">
                      {REPO_LABEL[repo.kind]}
                    </span>
                    {repo.initialized ? (
                      <span className="flex items-center gap-1 text-[11px] font-normal text-ok">
                        <CheckCircle2 className="size-3" aria-hidden /> hazır
                      </span>
                    ) : (
                      <span className="flex items-center gap-1 text-[11px] font-normal text-warn">
                        <AlertTriangle className="size-3" aria-hidden /> oluşturulmadı
                      </span>
                    )}
                  </div>
                  <code className="block truncate font-mono text-[11px] text-subtle">
                    {repo.location}
                  </code>
                  <span className="text-[11px] text-subtle">
                    {repo.jobCount} iş · son kontrol {when(repo.lastCheckAt)}
                    {repo.lastError && ` · ${repo.lastError}`}
                  </span>
                </div>
                <div className="flex gap-1">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void call("/api/backup/repos", "POST", { action: "check", id: repo.id })}
                    className="rounded-md border border-line px-2.5 py-1.5 text-xs transition-colors hover:border-brand disabled:opacity-50"
                  >
                    Sına
                  </button>
                  {!repo.initialized && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void call("/api/backup/repos", "POST", { action: "init", id: repo.id })}
                      className="rounded-md border border-line px-2.5 py-1.5 text-xs transition-colors hover:border-brand disabled:opacity-50"
                    >
                      Depoyu oluştur
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setRepoDraft({ ...repo, password: "", env: "" })}
                    className="rounded-md border border-line px-2.5 py-1.5 text-xs transition-colors hover:border-brand"
                  >
                    Düzenle
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      if (confirm(`"${repo.name}" kaydı silinsin mi? Diskteki yedeklere dokunulmaz.`)) {
                        void call(`/api/backup/repos?id=${repo.id}`, "DELETE");
                      }
                    }}
                    className="rounded border border-line p-1.5 text-subtle transition-colors hover:text-danger disabled:opacity-50"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* --- İşler --- */}
      <section className="rounded-lg border border-line bg-surface">
        <div className="flex items-center justify-between border-b border-line px-5 py-3">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <HardDrive className="size-4 text-subtle" aria-hidden />
            Yedekleme işleri
            <span className="font-normal text-subtle">{data.jobs.length}</span>
          </h2>
          <button
            type="button"
            disabled={data.repos.length === 0}
            title={data.repos.length === 0 ? "Önce bir depo tanımla" : undefined}
            onClick={() =>
              setJobDraft({
                name: "",
                repoId: data.repos[0]?.id,
                sourceKind: "volume",
                source: volumes[0] ?? "",
                scheduleCron: "0 3 * * *",
                quiesce: "",
                excludes: "",
                keepDaily: 7,
                keepWeekly: 4,
                keepMonthly: 6,
                enabled: true,
              })
            }
            className="flex items-center gap-1.5 rounded-md border border-line px-3 py-1.5 text-sm transition-colors hover:border-brand disabled:opacity-50"
          >
            <Plus className="size-4" /> İş ekle
          </button>
        </div>

        {data.jobs.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-subtle">
            Henüz yedekleme işi yok.
          </p>
        ) : (
          <ul className="divide-y divide-line">
            {data.jobs.map((job) => {
              const Icon = SOURCE_ICON[job.sourceKind];
              return (
                <li key={job.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                  <Icon className="size-4 shrink-0 text-subtle" aria-hidden />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
                      {job.name}
                      {!job.enabled && (
                        <span className="rounded border border-line px-1 text-[10px] font-normal text-subtle">
                          kapalı
                        </span>
                      )}
                      {job.lastStatus === "ok" && (
                        <CheckCircle2 className="size-3.5 text-ok" aria-hidden />
                      )}
                      {job.lastStatus === "error" && (
                        <XCircle className="size-3.5 text-danger" aria-hidden />
                      )}
                    </div>
                    <span className="text-[11px] text-subtle">
                      {SOURCE_LABEL[job.sourceKind]}
                      {job.source && `: ${job.source}`} → {job.repoName} ·{" "}
                      {job.scheduleCron || "zamanlanmamış"} · saklama {job.keepDaily}g/
                      {job.keepWeekly}h/{job.keepMonthly}a
                      {job.quiesce && ` · ${job.quiesce} durdurulur`}
                    </span>
                    <span className="block text-[11px] text-subtle">
                      son çalışma: {when(job.lastRunAt)}
                    </span>
                  </div>
                  <div className="flex gap-1">
                    <button
                      type="button"
                      disabled={busy}
                      title="Şimdi yedekle"
                      onClick={() => void call("/api/backup/jobs", "POST", { action: "run", id: job.id })}
                      className="flex items-center gap-1 rounded-md border border-line px-2.5 py-1.5 text-xs transition-colors hover:border-brand disabled:opacity-50"
                    >
                      <Play className="size-3.5" /> Yedekle
                    </button>
                    <button
                      type="button"
                      onClick={() => setSnapshotsFor(job)}
                      className="rounded-md border border-line px-2.5 py-1.5 text-xs transition-colors hover:border-brand"
                    >
                      Snapshot&apos;lar
                    </button>
                    <button
                      type="button"
                      onClick={() => setJobDraft(job)}
                      className="rounded-md border border-line px-2.5 py-1.5 text-xs transition-colors hover:border-brand"
                    >
                      Düzenle
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        if (confirm(`"${job.name}" işi silinsin mi? Depodaki snapshot'lar kalır.`)) {
                          void call(`/api/backup/jobs?id=${job.id}`, "DELETE");
                        }
                      }}
                      className="rounded border border-line p-1.5 text-subtle transition-colors hover:text-danger disabled:opacity-50"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* --- Geçmiş --- */}
      <section className="rounded-lg border border-line bg-surface">
        <div className="border-b border-line px-5 py-3">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <History className="size-4 text-subtle" aria-hidden />
            Çalışma geçmişi
          </h2>
        </div>
        {data.runs.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-subtle">Henüz çalışma yok.</p>
        ) : (
          <ul className="divide-y divide-line">
            {data.runs.slice(0, 20).map((run) => (
              <li key={run.id} className="flex flex-wrap items-baseline gap-x-3 px-5 py-2 text-xs">
                <span className="w-36 shrink-0 tabular-nums text-subtle">
                  {new Date(run.startedAt * 1000).toLocaleString("tr-TR")}
                </span>
                <span className="w-32 shrink-0 truncate font-medium">{run.jobName}</span>
                <span
                  className={`w-14 shrink-0 ${
                    run.status === "ok"
                      ? "text-ok"
                      : run.status === "error"
                        ? "text-danger"
                        : "text-subtle"
                  }`}
                >
                  {run.status}
                </span>
                <span className="min-w-0 flex-1 text-subtle">{run.detail}</span>
                <span className="shrink-0 tabular-nums text-subtle">
                  {run.bytesAdded > 0 && formatBytes(run.bytesAdded)}
                  {run.durationMs > 0 && ` · ${(run.durationMs / 1000).toFixed(1)} sn`}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <RepoModal
        key={`repo-${repoDraft?.id ?? (repoDraft ? "yeni" : "yok")}`}
        draft={repoDraft}
        busy={busy}
        onClose={() => setRepoDraft(null)}
        onSubmit={async (payload, isNew) => {
          if (await call("/api/backup/repos", isNew ? "POST" : "PATCH", payload)) {
            setRepoDraft(null);
          }
        }}
      />

      <JobModal
        key={`job-${jobDraft?.id ?? (jobDraft ? "yeni" : "yok")}`}
        draft={jobDraft}
        repos={data.repos}
        volumes={volumes}
        containers={containers}
        busy={busy}
        onClose={() => setJobDraft(null)}
        onSubmit={async (payload, isNew) => {
          if (await call("/api/backup/jobs", isNew ? "POST" : "PATCH", payload)) {
            setJobDraft(null);
          }
        }}
      />

      {/* `key` işe bağlı: başka bir işin snapshot'ları açılınca bileşen
          yeniden kurulur ve önceki listeden hiçbir şey sızmaz. */}
      <SnapshotsModal
        key={snapshotsFor?.id ?? "yok"}
        job={snapshotsFor}
        onClose={() => setSnapshotsFor(null)}
      />
    </div>
  );
}

function RepoModal({
  draft,
  busy,
  onClose,
  onSubmit,
}: {
  draft: (Partial<BackupRepo> & { password?: string; env?: string }) | null;
  busy: boolean;
  onClose: () => void;
  onSubmit: (payload: Record<string, unknown>, isNew: boolean) => void;
}) {
  // Taslak `key` ile bileşene bağlı: yeni bir depo açılınca bileşen yeniden
  // kurulur ve form kendiliğinden doğru değerlerle başlar.
  const [form, setForm] = useState(draft);
  const isNew = !form?.id;

  return (
    <Modal open={draft !== null} title={isNew ? "Depo ekle" : "Depoyu düzenle"} onClose={onClose}>
      {form && (
        <div className="space-y-3">
          <label className="block text-sm">
            <span className="text-subtle">Ad</span>
            <input
              value={form.name ?? ""}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className={inputClass}
            />
          </label>

          <label className="block text-sm">
            <span className="text-subtle">Tür</span>
            <select
              value={form.kind ?? "local"}
              onChange={(e) => setForm({ ...form, kind: e.target.value as BackupRepo["kind"] })}
              className={inputClass}
            >
              <option value="local">Yerel dizin</option>
              <option value="rclone">rclone (off-site)</option>
              <option value="s3">S3 uyumlu</option>
            </select>
          </label>

          <label className="block text-sm">
            <span className="text-subtle">
              {form.kind === "local" ? "Host üzerindeki yol" : "restic deposu adresi"}
            </span>
            <input
              value={form.location ?? ""}
              onChange={(e) => setForm({ ...form, location: e.target.value })}
              placeholder={
                form.kind === "local"
                  ? "/mnt/yedek/restic"
                  : form.kind === "s3"
                    ? "s3:s3.amazonaws.com/kova-adi"
                    : "rclone:uzak:yedek"
              }
              className={`${inputClass} font-mono`}
            />
            {form.kind === "local" && (
              <span className="mt-1 block text-xs text-subtle">
                Yedeği yedeklenen verinin durduğu diske koymak, tek bir arızada ikisini birden
                kaybetmek demektir. Mümkünse ayrı bir disk ya da ağ paylaşımı seç.
              </span>
            )}
          </label>

          <label className="block text-sm">
            <span className="text-subtle">
              Depo parolası {isNew ? "" : "(değiştirmek istemiyorsan boş bırak)"}
            </span>
            <input
              type="text"
              autoComplete="off"
              value={form.password ?? ""}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              className={`${inputClass} font-mono`}
            />
          </label>

          <p className="rounded-md bg-warn/10 px-3 py-2 text-xs text-warn">
            <strong>Bu parolayı panelin dışında da sakla.</strong> Panel onu MASTER_KEY ile
            şifreliyor; anahtar kaybolursa panel parolayı çözemez ve yedeklerine buradan
            ulaşamazsın. Parola elindeyse restic deposu panel olmadan da açılır.
          </p>

          {form.kind !== "local" && (
            <label className="block text-sm">
              <span className="text-subtle">Ek ortam değişkenleri</span>
              <textarea
                rows={3}
                value={form.env ?? ""}
                onChange={(e) => setForm({ ...form, env: e.target.value })}
                placeholder={"AWS_ACCESS_KEY_ID=...\nAWS_SECRET_ACCESS_KEY=..."}
                className={`${inputClass} font-mono`}
              />
              <span className="mt-1 block text-xs text-subtle">
                Satır başına bir <code>ANAHTAR=değer</code>. Şifreli saklanır.
              </span>
            </label>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-line px-3 py-1.5 text-sm text-subtle transition-colors hover:text-ink"
            >
              Vazgeç
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => onSubmit({ ...form }, isNew)}
              className="rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              Kaydet
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}

function JobModal({
  draft,
  repos,
  volumes,
  containers,
  busy,
  onClose,
  onSubmit,
}: {
  draft: Partial<BackupJob> | null;
  repos: BackupRepo[];
  volumes: string[];
  containers: string[];
  busy: boolean;
  onClose: () => void;
  onSubmit: (payload: Record<string, unknown>, isNew: boolean) => void;
}) {
  const [form, setForm] = useState(draft);
  const isNew = !form?.id;

  return (
    <Modal
      open={draft !== null}
      title={isNew ? "Yedekleme işi ekle" : "İşi düzenle"}
      onClose={onClose}
      wide
    >
      {form && (
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-sm">
              <span className="text-subtle">İş adı</span>
              <input
                value={form.name ?? ""}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className={inputClass}
              />
            </label>
            <label className="block text-sm">
              <span className="text-subtle">Depo</span>
              <select
                value={form.repoId ?? 0}
                onChange={(e) => setForm({ ...form, repoId: Number(e.target.value) })}
                className={inputClass}
              >
                {repos.map((repo) => (
                  <option key={repo.id} value={repo.id}>
                    {repo.name}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-sm">
              <span className="text-subtle">Kaynak türü</span>
              <select
                value={form.sourceKind ?? "volume"}
                onChange={(e) =>
                  setForm({
                    ...form,
                    sourceKind: e.target.value as SourceKind,
                    source: e.target.value === "volume" ? (volumes[0] ?? "") : "",
                  })
                }
                className={inputClass}
              >
                <option value="volume">Docker volume</option>
                <option value="host_dir">Host dizini</option>
                <option value="panel_db">Panel veritabanı</option>
              </select>
            </label>

            {form.sourceKind === "volume" && (
              <label className="block text-sm">
                <span className="text-subtle">Volume</span>
                <select
                  value={form.source ?? ""}
                  onChange={(e) => setForm({ ...form, source: e.target.value })}
                  className={inputClass}
                >
                  {volumes.map((volume) => (
                    <option key={volume} value={volume}>
                      {volume}
                    </option>
                  ))}
                </select>
              </label>
            )}

            {form.sourceKind === "host_dir" && (
              <label className="block text-sm">
                <span className="text-subtle">Host yolu</span>
                <input
                  value={form.source ?? ""}
                  onChange={(e) => setForm({ ...form, source: e.target.value })}
                  placeholder="/home/coraspirin/docker"
                  className={`${inputClass} font-mono`}
                />
              </label>
            )}
          </div>

          {form.sourceKind === "panel_db" && (
            <p className="rounded-md bg-brand/5 px-3 py-2 text-xs text-subtle">
              Panel veritabanının <code>VACUUM INTO</code> ile tutarlı bir kopyası alınıp panel
              veri volume&apos;üyle birlikte yedeklenir. Canlı <code>panel.db</code> dosyaları
              dışarıda bırakılır — WAL yüzünden yarım kopyalanabilirler.
              <strong> .env ve MASTER_KEY yedeğe girmez</strong>; girseydi şifreleme anlamsız
              olurdu.
            </p>
          )}

          <div>
            <span className="text-sm text-subtle">Sıklık</span>
            <div className="mt-1">
              <CronEditor
                value={form.scheduleCron ?? "0 3 * * *"}
                disabled={busy}
                onCommit={(value) => setForm({ ...form, scheduleCron: String(value) })}
              />
            </div>
          </div>

          <label className="block text-sm">
            <span className="text-subtle">Yedek alınırken durdurulacak container</span>
            <select
              value={form.quiesce ?? ""}
              onChange={(e) => setForm({ ...form, quiesce: e.target.value })}
              className={inputClass}
            >
              <option value="">Durdurma (canlı kopyala)</option>
              {containers.map((container) => (
                <option key={container} value={container}>
                  {container}
                </option>
              ))}
            </select>
            <span className="mt-1 block text-xs text-subtle">
              SQLite kullanan servisler (Home Assistant, Vaultwarden…) çalışırken kopyalanırsa
              yedek bozuk çıkabilir. Durdurma yalnızca yedek süresince geçerli — iş başarısız
              olsa bile container geri açılır.
            </span>
          </label>

          <div className="grid gap-3 sm:grid-cols-3">
            {(
              [
                ["keepDaily", "Günlük saklanacak"],
                ["keepWeekly", "Haftalık saklanacak"],
                ["keepMonthly", "Aylık saklanacak"],
              ] as const
            ).map(([key, label]) => (
              <label key={key} className="block text-sm">
                <span className="text-subtle">{label}</span>
                <input
                  type="number"
                  min={0}
                  max={365}
                  value={form[key] ?? 0}
                  onChange={(e) => setForm({ ...form, [key]: Number(e.target.value) })}
                  className={inputClass}
                />
              </label>
            ))}
          </div>

          <label className="block text-sm">
            <span className="text-subtle">Hariç tutulacaklar</span>
            <textarea
              rows={2}
              value={form.excludes ?? ""}
              onChange={(e) => setForm({ ...form, excludes: e.target.value })}
              placeholder={"*.tmp\n/data/cache"}
              className={`${inputClass} font-mono`}
            />
          </label>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.enabled !== false}
              onChange={(e) => setForm({ ...form, enabled: e.target.checked })}
              className="size-4 accent-[var(--brand)]"
            />
            Zamanlanmış olarak çalışsın
          </label>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-line px-3 py-1.5 text-sm text-subtle transition-colors hover:text-ink"
            >
              Vazgeç
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => onSubmit({ ...form }, isNew)}
              className="rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              Kaydet
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}

function SnapshotsModal({ job, onClose }: { job: BackupJob | null; onClose: () => void }) {
  const [snapshots, setSnapshots] = useState<Snapshot[] | null>(null);
  const [target, setTarget] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const jobId = job?.id ?? null;

  /*
    Snapshot listesi depodan okunuyor ve bu restic çalıştırmak demek — saniyeler
    sürebilir. Sayfa açılışında değil, yalnızca modal açıldığında yapılıyor.

    `ignore` bayrağı: kullanıcı modalı kapatıp başka bir işi açarsa önceki
    isteğin geç gelen cevabı yanlış listeyi göstermemeli.

    Durum sıfırlaması burada YAPILMIYOR — bileşen çağrıldığı yerde `key` ile
    işe bağlı, iş değişince yeniden kuruluyor ve state kendiliğinden temiz
    geliyor. Efekt içinde senkron setState çağırmak gereksiz render zinciri
    üretirdi.
  */
  useEffect(() => {
    if (jobId === null) return;

    let ignore = false;

    void (async () => {
      try {
        const response = await fetch(`/api/backup/snapshots?jobId=${jobId}`);
        const data = (await response.json()) as { snapshots?: Snapshot[]; error?: string };
        if (ignore) return;
        setSnapshots(data.snapshots ?? []);
        if (data.error) setMessage(data.error);
      } catch {
        if (!ignore) {
          setSnapshots([]);
          setMessage("Depo okunamadı.");
        }
      }
    })();

    return () => {
      ignore = true;
    };
  }, [jobId]);

  async function restore() {
    if (!job || !selected) return;
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch("/api/backup/snapshots", {
        method: "POST",
        headers: { "content-type": "application/json", [CSRF_HEADER]: readCsrfToken() },
        body: JSON.stringify({ jobId: job.id, snapshotId: selected, target }),
      });
      const data = (await response.json()) as { ok?: boolean; error?: string; message?: string };
      setMessage(data.error ?? data.message ?? "Tamamlandı.");
    } catch {
      setMessage("Sunucuya ulaşılamadı.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={job !== null}
      title={`Snapshot'lar — ${job?.name ?? ""}`}
      onClose={onClose}
      wide
    >
      {snapshots === null ? (
        <p className="py-6 text-center text-sm text-subtle">Depo okunuyor…</p>
      ) : snapshots.length === 0 ? (
        <p className="py-6 text-center text-sm text-subtle">
          Bu işe ait snapshot yok. Önce bir yedek al.
        </p>
      ) : (
        <ul className="divide-y divide-line rounded-md border border-line">
          {snapshots.map((snapshot) => (
            <li key={snapshot.id}>
              <label className="flex cursor-pointer items-center gap-3 px-3 py-2 text-sm hover:bg-line/30">
                <input
                  type="radio"
                  name="snapshot"
                  checked={selected === snapshot.id}
                  onChange={() => setSelected(snapshot.id)}
                  className="size-4 accent-[var(--brand)]"
                />
                <span className="font-mono text-xs">{snapshot.shortId}</span>
                <span className="flex-1">
                  {new Date(snapshot.time * 1000).toLocaleString("tr-TR")}
                </span>
                <span className="text-xs text-subtle">
                  {snapshot.sizeBytes !== null && formatBytes(snapshot.sizeBytes)}
                </span>
              </label>
            </li>
          ))}
        </ul>
      )}

      {snapshots !== null && snapshots.length > 0 && (
        <div className="mt-4 space-y-2 rounded-md border border-warn/40 bg-warn/5 p-3">
          <p className="flex items-center gap-1.5 text-sm font-medium text-warn">
            <RotateCcw className="size-4" aria-hidden /> Geri yükleme
          </p>
          <p className="text-xs text-subtle">
            Dosyalar seçtiğin <strong>boş</strong> klasöre açılır — kaynağın üzerine
            YAZILMAZ. Ne geldiğine bakıp istediğini kendin taşırsın. Sistem dizinleri hedef
            olarak kabul edilmez.
          </p>
          <div className="flex flex-wrap gap-2">
            <input
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              placeholder="/home/coraspirin/geri-yukleme"
              className="min-w-0 flex-1 rounded-md border border-line bg-canvas px-3 py-1.5 font-mono text-sm outline-none focus:border-brand sm:min-w-56"
            />
            <button
              type="button"
              disabled={busy || !selected || !target}
              onClick={() => void restore()}
              className="rounded-md bg-warn px-3 py-1.5 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {busy ? "Açılıyor…" : "Geri yükle"}
            </button>
          </div>
        </div>
      )}

      {message && <p className="mt-3 whitespace-pre-wrap text-sm">{message}</p>}
    </Modal>
  );
}
