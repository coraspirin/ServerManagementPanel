"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, Plus, X } from "lucide-react";
import { readCsrfToken } from "./detail/shared";
import { CSRF_HEADER } from "@/lib/auth/types";
import {
  RESTART_POLICIES,
  specProblem,
  type ContainerSpec,
  type KeyValue,
  type PortMapping,
  type VolumeMount,
} from "@/lib/docker/spec";
import type { DockerNetwork } from "@/lib/providers/types";
import type { DockerOverview } from "@/lib/docker/types";
import { useT } from "@/lib/i18n/client";

/**
 * Container ayrıntıları formu (M3.46).
 *
 * ## Neden her yol buraya çıkıyor
 *
 * Container üç kaynaktan doğabiliyor: bir compose servisinden, çekilen bir
 * imajdan ya da sıfırdan. Üçü için üç ayrı form yazmak, port satırının
 * doğrulamasını üç yerde tutmak demekti. Kaynaklar yalnızca bu formu ÖN
 * DOLDURUYOR; düzenleme ve oluşturma tek yerde.
 *
 * ## Hiçbir şey kendiliğinden oluşmuyor
 *
 * YAML eklemek de, image çekmek de container YARATMIYOR — ikisi de yalnızca
 * bu formu dolduruyor. Container ancak "Konteyner oluştur" düğmesine
 * basıldığında var oluyor. Kullanıcının açık isteği buydu ve doğru olan da
 * bu: çekilen bir imaj, çalıştırılmak istendiği anlamına gelmiyor.
 *
 * ## Ön doldurulan değerler DÜZENLENEBİLİR
 *
 * Compose'dan gelen port, imajdan gelen ortam değişkeni — hepsi normal birer
 * form alanı. Salt-okunur göstermek, kullanıcıyı "önce oluştur, sonra düzelt"
 * gibi iki adımlı ve container'ı yeniden yaratmayı gerektiren bir yola iterdi.
 */

const inputClass =
  "w-full rounded-md border border-line bg-canvas px-2 py-1.5 text-sm outline-none focus:border-brand disabled:opacity-50";

function Field({
  label,
  help,
  children,
}: {
  label: string;
  help?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="text-xs font-medium">{label}</span>
      <div className="mt-1">{children}</div>
      {help && <p className="mt-1 text-[11px] leading-snug text-subtle">{help}</p>}
    </label>
  );
}

/** Satır ekle/sil iskeleti — port, volume, ortam ve etiket listeleri ortak. */
function RowList<T>({
  title,
  help,
  rows,
  empty,
  onAdd,
  onRemove,
  render,
}: {
  title: string;
  help?: string;
  rows: T[];
  empty: string;
  onAdd: () => void;
  onRemove: (index: number) => void;
  render: (row: T, index: number) => React.ReactNode;
}) {
  const t = useT();

  return (
    <section className="rounded-md border border-line">
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2">
        <h3 className="text-xs font-medium">{title}</h3>
        <button
          type="button"
          onClick={onAdd}
          className="ml-auto inline-flex items-center gap-1 rounded border border-line px-1.5 py-0.5 text-[11px] text-subtle transition-colors hover:border-brand hover:text-brand"
        >
          <Plus className="size-3" aria-hidden />
          {t("docker.create.addRow")}
        </button>
      </div>

      {help && <p className="px-3 pt-2 text-[11px] leading-snug text-subtle">{help}</p>}

      {rows.length === 0 ? (
        <p className="px-3 py-3 text-[11px] text-subtle">{empty}</p>
      ) : (
        <ul className="space-y-1.5 px-3 py-2">
          {rows.map((row, index) => (
            <li key={index} className="flex items-center gap-1.5">
              <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
                {render(row, index)}
              </div>
              <button
                type="button"
                onClick={() => onRemove(index)}
                aria-label={t("docker.create.removeRow")}
                className="shrink-0 rounded p-1 text-subtle transition-colors hover:text-danger"
              >
                <X className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function ContainerCreateForm({
  spec,
  warnings,
  onChange,
  onCreated,
  onCancel,
}: {
  spec: ContainerSpec;
  /** Kaynaktan (compose/image) taşınamayan şeyler; kullanıcı görmeli. */
  warnings: string[];
  onChange: (spec: ContainerSpec) => void;
  /** Oluşturma başarılı — güncel tablo ve sonuç metni. */
  onCreated: (data: DockerOverview, message: string) => void;
  onCancel: () => void;
}) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [networks, setNetworks] = useState<DockerNetwork[] | null>(null);

  useEffect(() => {
    const controller = new AbortController();

    (async () => {
      try {
        const response = await fetch("/api/docker/resources", {
          cache: "no-store",
          signal: controller.signal,
        });
        if (response.ok) {
          const payload = (await response.json()) as { networks: DockerNetwork[] };
          setNetworks(payload.networks);
        } else {
          setNetworks([]);
        }
      } catch (fetchError) {
        if ((fetchError as Error)?.name !== "AbortError") setNetworks([]);
      }
    })();

    return () => controller.abort();
  }, []);

  const patch = (changes: Partial<ContainerSpec>) => onChange({ ...spec, ...changes });

  const setRow = <K extends "ports" | "volumes" | "env" | "labels">(
    key: K,
    index: number,
    changes: Partial<ContainerSpec[K][number]>,
  ) => {
    const rows = [...spec[key]] as ContainerSpec[K];
    rows[index] = { ...rows[index], ...changes } as ContainerSpec[K][number];
    patch({ [key]: rows } as Partial<ContainerSpec>);
  };

  const removeRow = (key: "ports" | "volumes" | "env" | "labels", index: number) =>
    patch({ [key]: spec[key].filter((_, i) => i !== index) } as Partial<ContainerSpec>);

  const problem = specProblem(spec, t);

  async function create() {
    if (problem) {
      setError(problem);
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/docker/create", {
        method: "POST",
        headers: { "content-type": "application/json", [CSRF_HEADER]: readCsrfToken() },
        body: JSON.stringify(spec),
      });
      const payload = (await response.json()) as DockerOverview & {
        error?: string;
        started?: boolean;
        warnings?: string[];
        name?: string;
      };

      if (!response.ok) {
        setError(payload.error ?? t("docker.create.createFailed"));
        return;
      }

      const notes = payload.warnings ?? [];
      onCreated(
        payload,
        [
          payload.started
            ? t("docker.create.createdStarted", { name: payload.name ?? "" })
            : t("docker.create.created", { name: payload.name ?? "" }),
          ...notes,
        ].join(" "),
      );
    } catch {
      setError(t("common.errors.network"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      {warnings.length > 0 && (
        <div className="flex gap-2 rounded-md border border-warn/40 bg-warn/5 px-3 py-2">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-warn" aria-hidden />
          <ul className="space-y-0.5 text-[11px] leading-snug text-warn">
            {warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t("docker.create.name")} help={t("docker.create.nameHelp")}>
          <input
            value={spec.name}
            onChange={(e) => patch({ name: e.target.value })}
            placeholder={t("docker.create.namePlaceholder")}
            className={`font-mono ${inputClass}`}
            autoFocus
          />
        </Field>

        <Field label={t("docker.create.image")} help={t("docker.create.imageHelp")}>
          <input
            value={spec.image}
            onChange={(e) => patch({ image: e.target.value })}
            placeholder="nginx:alpine"
            className={`font-mono ${inputClass}`}
          />
        </Field>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t("docker.create.restartPolicy")}>
          <select
            value={spec.restart}
            onChange={(e) => patch({ restart: e.target.value as ContainerSpec["restart"] })}
            className={inputClass}
          >
            {RESTART_POLICIES.map((policy) => (
              <option key={policy.value} value={policy.value}>
                {t(policy.labelKey)}
              </option>
            ))}
          </select>
        </Field>

        <Field
          label={t("docker.create.networks")}
          help={
            networks === null
              ? t("docker.create.networksLoading")
              : t("docker.create.networksHelp")
          }
        >
          <div className="max-h-28 space-y-0.5 overflow-y-auto rounded-md border border-line bg-canvas px-2 py-1.5">
            {(networks ?? []).length === 0 ? (
              <span className="text-[11px] text-subtle">
                {networks === null
                  ? t("common.states.loadingInline")
                  : t("docker.create.noNetworks")}
              </span>
            ) : (
              networks!.map((network) => (
                <label key={network.id} className="flex items-center gap-1.5 text-xs">
                  <input
                    type="checkbox"
                    checked={spec.networks.includes(network.name)}
                    onChange={() =>
                      patch({
                        networks: spec.networks.includes(network.name)
                          ? spec.networks.filter((entry) => entry !== network.name)
                          : [...spec.networks, network.name],
                      })
                    }
                    className="size-3.5 accent-[var(--brand)]"
                  />
                  <span className="truncate font-mono">{network.name}</span>
                </label>
              ))
            )}
          </div>
        </Field>
      </div>

      <RowList
        title={t("docker.create.ports")}
        help={t("docker.create.portsHelp")}
        rows={spec.ports}
        empty={t("docker.create.portsEmpty")}
        onAdd={() =>
          patch({
            ports: [
              ...spec.ports,
              { hostPort: "", hostIp: "", containerPort: "", protocol: "tcp" } as PortMapping,
            ],
          })
        }
        onRemove={(index) => removeRow("ports", index)}
        render={(row, index) => (
          <>
            <input
              value={row.hostIp}
              onChange={(e) => setRow("ports", index, { hostIp: e.target.value })}
              placeholder={t("docker.create.hostIp")}
              className={`w-28 font-mono ${inputClass}`}
            />
            <input
              value={row.hostPort}
              onChange={(e) => setRow("ports", index, { hostPort: e.target.value })}
              placeholder={t("docker.create.host")}
              className={`w-20 font-mono ${inputClass}`}
            />
            <span className="text-xs text-subtle">→</span>
            <input
              value={row.containerPort}
              onChange={(e) => setRow("ports", index, { containerPort: e.target.value })}
              placeholder={t("docker.create.container")}
              className={`w-24 font-mono ${inputClass}`}
            />
            <select
              value={row.protocol}
              onChange={(e) =>
                setRow("ports", index, { protocol: e.target.value as "tcp" | "udp" })
              }
              className={`w-20 ${inputClass}`}
            >
              <option value="tcp">tcp</option>
              <option value="udp">udp</option>
            </select>
          </>
        )}
      />

      <RowList
        title={t("docker.create.volumes")}
        help={t("docker.create.volumesHelp")}
        rows={spec.volumes}
        empty={t("docker.create.volumesEmpty")}
        onAdd={() =>
          patch({
            volumes: [
              ...spec.volumes,
              { source: "", target: "", readOnly: false } as VolumeMount,
            ],
          })
        }
        onRemove={(index) => removeRow("volumes", index)}
        render={(row, index) => (
          <>
            <input
              value={row.source}
              onChange={(e) => setRow("volumes", index, { source: e.target.value })}
              placeholder={t("docker.create.source")}
              className={`min-w-0 flex-1 font-mono ${inputClass}`}
            />
            <span className="text-xs text-subtle">→</span>
            <input
              value={row.target}
              onChange={(e) => setRow("volumes", index, { target: e.target.value })}
              placeholder={t("docker.create.targetPlaceholder")}
              className={`min-w-0 flex-1 font-mono ${inputClass}`}
            />
            <label className="flex shrink-0 items-center gap-1 text-[11px] text-subtle">
              <input
                type="checkbox"
                checked={row.readOnly}
                onChange={(e) => setRow("volumes", index, { readOnly: e.target.checked })}
                className="size-3.5 accent-[var(--brand)]"
              />
              {t("docker.create.readOnly")}
            </label>
          </>
        )}
      />

      <RowList
        title={t("docker.create.env")}
        rows={spec.env}
        empty={t("docker.create.envEmpty")}
        onAdd={() => patch({ env: [...spec.env, { key: "", value: "" } as KeyValue] })}
        onRemove={(index) => removeRow("env", index)}
        render={(row, index) => (
          <>
            <input
              value={row.key}
              onChange={(e) => setRow("env", index, { key: e.target.value })}
              placeholder={t("docker.create.keyUpper")}
              className={`w-40 font-mono ${inputClass}`}
            />
            <input
              value={row.value}
              onChange={(e) => setRow("env", index, { value: e.target.value })}
              placeholder={t("docker.create.value")}
              className={`min-w-0 flex-1 font-mono ${inputClass}`}
            />
          </>
        )}
      />

      <details className="rounded-md border border-line">
        <summary className="cursor-pointer px-3 py-2 text-xs text-subtle">
          {t("docker.create.advanced")}
        </summary>

        <div className="space-y-3 border-t border-line px-3 py-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t("docker.create.command")} help={t("docker.create.commandHelp")}>
              <input
                value={spec.command}
                onChange={(e) => patch({ command: e.target.value })}
                className={`font-mono ${inputClass}`}
              />
            </Field>
            <Field label={t("docker.create.entrypoint")} help={t("docker.create.entrypointHelp")}>
              <input
                value={spec.entrypoint}
                onChange={(e) => patch({ entrypoint: e.target.value })}
                className={`font-mono ${inputClass}`}
              />
            </Field>
            <Field label={t("docker.create.user")} help={t("docker.create.userHelp")}>
              <input
                value={spec.user}
                onChange={(e) => patch({ user: e.target.value })}
                className={`font-mono ${inputClass}`}
              />
            </Field>
            <Field label={t("docker.create.workingDir")}>
              <input
                value={spec.workingDir}
                onChange={(e) => patch({ workingDir: e.target.value })}
                className={`font-mono ${inputClass}`}
              />
            </Field>
            <Field label={t("docker.create.hostname")}>
              <input
                value={spec.hostname}
                onChange={(e) => patch({ hostname: e.target.value })}
                className={`font-mono ${inputClass}`}
              />
            </Field>
          </div>

          <RowList
            title={t("docker.create.labels")}
            rows={spec.labels}
            empty={t("docker.create.labelsEmpty")}
            onAdd={() => patch({ labels: [...spec.labels, { key: "", value: "" } as KeyValue] })}
            onRemove={(index) => removeRow("labels", index)}
            render={(row, index) => (
              <>
                <input
                  value={row.key}
                  onChange={(e) => setRow("labels", index, { key: e.target.value })}
                  placeholder={t("docker.create.keyLower")}
                  className={`w-40 font-mono ${inputClass}`}
                />
                <input
                  value={row.value}
                  onChange={(e) => setRow("labels", index, { value: e.target.value })}
                  placeholder={t("docker.create.value")}
                  className={`min-w-0 flex-1 font-mono ${inputClass}`}
                />
              </>
            )}
          />

          <label className="flex items-start gap-2 rounded-md border border-danger/30 bg-danger/5 px-3 py-2">
            <input
              type="checkbox"
              checked={spec.privileged}
              onChange={(e) => patch({ privileged: e.target.checked })}
              className="mt-0.5 size-4 accent-[var(--brand)]"
            />
            <span className="text-xs">
              <span className="font-medium text-danger">{t("docker.create.privileged")}</span>
              <span className="mt-0.5 block text-subtle">{t("docker.create.privilegedHelp")}</span>
            </span>
          </label>
        </div>
      </details>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={spec.autoStart}
          onChange={(e) => patch({ autoStart: e.target.checked })}
          className="size-4 accent-[var(--brand)]"
        />
        {t("docker.create.autoStart")}
      </label>

      {error && (
        <p role="alert" className="rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}

      <div className="flex flex-wrap justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="rounded-md border border-line px-3 py-1.5 text-sm text-subtle transition-colors hover:text-ink disabled:opacity-50"
        >
          {t("common.actions.back")}
        </button>
        <button
          type="button"
          disabled={busy || problem !== null}
          title={problem ?? undefined}
          onClick={() => void create()}
          className="rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {busy ? t("docker.create.creating") : t("docker.create.submit")}
        </button>
      </div>
    </div>
  );
}
