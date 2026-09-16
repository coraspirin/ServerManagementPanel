"use client";

import { useState } from "react";
import { AlertTriangle, BookText, Link2, Pencil } from "lucide-react";

import { Markdown } from "@/components/docker/Markdown";
import { CSRF_HEADER } from "@/lib/auth/types";
import type { Dependency } from "@/lib/docker/graph";
import type { Runbook } from "@/lib/docker/runbooks";
import type { ContainerDetail, RestartPolicy } from "@/lib/providers/types";
import { useFormat, useT } from "@/lib/i18n/client";
import { Rich } from "@/lib/i18n/rich";

import { readCsrfToken, Row, Section } from "./shared";

/** Politikaların sırası; adları dil dosyasında (`docker.general.policy.<ad>`). */
const POLICIES: RestartPolicy["name"][] = ["no", "always", "unless-stopped", "on-failure"];

/** Genel sekmesi: etki, kimlik, sağlık, politika, mount'lar, runbook. */
export function GeneralTab({
  containerId,
  detail,
  impact,
  runbook,
  canAct,
}: {
  containerId: string;
  detail: ContainerDetail;
  impact: Dependency[];
  runbook: Runbook | null;
  canAct: boolean;
}) {
  const t = useT();
  const f = useFormat();

  return (
    <div className="space-y-5">
      <Impact impact={impact} name={detail.name} />

      <Section title={t("docker.general.identity")}>
        <dl className="space-y-1.5 text-sm">
          <Row label={t("docker.general.image")}>
            <span className="font-mono text-[11px]">{detail.image}</span>
          </Row>
          <Row label={t("docker.general.state")}>
            <span className="font-mono text-[11px]">{detail.status}</span>
          </Row>
          {detail.startedAt && (
            <Row label={t("docker.general.started")}>{f.dateTime(detail.startedAt)}</Row>
          )}
          <Row label={t("docker.general.created")}>
            {f.dateTime(detail.createdAt * 1000)}
          </Row>
          {detail.composeService && (
            <Row label={t("docker.general.compose")}>
              {detail.composeProject} / {detail.composeService}
            </Row>
          )}
        </dl>
      </Section>

      <Section title={t("docker.general.health")}>
        {detail.healthcheck === null ? (
          <p className="text-sm text-subtle">{t("docker.general.noHealthcheck")}</p>
        ) : (
          <dl className="space-y-1.5 text-sm">
            <Row label={t("docker.general.state")}>
              <span
                className={
                  detail.health === "healthy"
                    ? "text-ok"
                    : detail.health === "unhealthy"
                      ? "text-danger"
                      : "text-warn"
                }
              >
                {detail.health ?? t("docker.general.healthUnknown")}
              </span>
              {detail.healthcheck.failingStreak > 0 && (
                <span className="ml-2 text-xs text-danger">
                  {t("docker.general.failingStreak", {
                    count: detail.healthcheck.failingStreak,
                  })}
                </span>
              )}
            </Row>
            <Row label={t("docker.general.command")}>
              <code className="font-mono text-[11px]">{detail.healthcheck.test.join(" ")}</code>
            </Row>
            {detail.healthcheck.intervalSeconds !== null && (
              <Row label={t("docker.general.interval")}>
                {t("docker.general.intervalValue", {
                  value: detail.healthcheck.intervalSeconds,
                })}
              </Row>
            )}
            {detail.healthcheck.lastOutput && (
              <Row label={t("docker.general.lastOutput")}>
                <pre className="mt-0.5 overflow-x-auto whitespace-pre-wrap rounded border border-line bg-canvas p-2 font-mono text-[11px]">
                  {detail.healthcheck.lastOutput}
                </pre>
              </Row>
            )}
          </dl>
        )}
      </Section>

      <RestartPolicySection
        containerId={containerId}
        initial={detail.restartPolicy}
        restartCount={detail.restartCount}
        composeProject={detail.composeProject}
        canAct={canAct}
      />

      <Section title={t("docker.general.mounts")}>
        {detail.mounts.length === 0 ? (
          <p className="text-sm text-subtle">{t("docker.general.noMounts")}</p>
        ) : (
          <ul className="space-y-0.5 break-all font-mono text-[11px]">
            {detail.mounts.map((mount) => (
              <li key={mount.destination}>
                {mount.volumeName ?? mount.source} → {mount.destination}
                {mount.readOnly && (
                  <span className="text-subtle"> {t("docker.general.readOnly")}</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <RunbookSection
        containerId={containerId}
        containerName={detail.name}
        initial={runbook}
        canAct={canAct}
      />
    </div>
  );
}

function Impact({ impact, name }: { impact: Dependency[]; name: string }) {
  const t = useT();

  if (impact.length === 0) {
    return (
      <div className="rounded-lg border border-line bg-surface px-4 py-3 text-sm text-subtle">
        <Rich
          text={t("docker.general.impactNone")}
          values={{ name: <span className="font-medium text-ink">{name}</span> }}
        />
      </div>
    );
  }

  const hard = impact.filter((entry) => entry.hard);

  return (
    <div
      className={`rounded-lg border px-4 py-3 ${
        hard.length > 0 ? "border-danger/40" : "border-warn/40"
      } bg-surface`}
    >
      <p className="flex items-center gap-1.5 text-sm font-medium">
        {hard.length > 0 ? (
          <AlertTriangle className="size-4 text-danger" aria-hidden />
        ) : (
          <Link2 className="size-4 text-warn" aria-hidden />
        )}
        {t("docker.general.impactTitle")}
      </p>

      <ul className="mt-2 space-y-1 text-sm">
        {impact.map((entry) => (
          <li key={entry.name} className="flex flex-wrap items-baseline gap-x-2">
            <span className="font-medium">{entry.name}</span>
            <span
              className={`rounded px-1 text-[10px] font-medium ${
                entry.hard ? "bg-danger/15 text-danger" : "bg-warn/15 text-warn"
              }`}
            >
              {entry.hard ? t("docker.general.impactHard") : t("docker.general.impactSoft")}
            </span>
            <span className="text-xs text-subtle">{entry.reason}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function RestartPolicySection({
  containerId,
  initial,
  restartCount,
  composeProject,
  canAct,
}: {
  containerId: string;
  initial: RestartPolicy;
  restartCount: number;
  composeProject: string | null;
  canAct: boolean;
}) {
  const t = useT();
  const [policy, setPolicy] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function save(next: RestartPolicy) {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const response = await fetch(
        `/api/docker/${encodeURIComponent(containerId)}/restart-policy`,
        {
          method: "POST",
          headers: { "content-type": "application/json", [CSRF_HEADER]: readCsrfToken() },
          body: JSON.stringify(next),
        },
      );
      const payload = await response.json();
      if (!response.ok) setError(payload.error ?? t("docker.general.changeFailed"));
      else {
        setPolicy(next);
        setSaved(true);
      }
    } catch {
      setError(t("common.errors.network"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section title={t("docker.general.restartTitle")}>
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={policy.name}
          disabled={!canAct || busy}
          onChange={(e) =>
            void save({
              name: e.target.value as RestartPolicy["name"],
              maximumRetryCount: policy.maximumRetryCount,
            })
          }
          className="rounded-md border border-line bg-canvas px-2 py-1.5 text-sm outline-none focus:border-brand disabled:opacity-50"
        >
          {POLICIES.map((name) => (
            <option key={name} value={name}>
              {t(`docker.general.policy.${name}`)}
            </option>
          ))}
        </select>

        {policy.name === "on-failure" && (
          <label className="flex items-center gap-1.5 text-xs text-subtle">
            {t("docker.general.atMost")}
            <input
              type="number"
              min={0}
              max={100}
              defaultValue={policy.maximumRetryCount}
              disabled={!canAct || busy}
              onBlur={(e) => {
                const value = Number(e.target.value);
                if (value !== policy.maximumRetryCount) {
                  void save({ name: policy.name, maximumRetryCount: value });
                }
              }}
              className="w-16 rounded-md border border-line bg-canvas px-2 py-1 text-sm outline-none focus:border-brand"
            />
            {t("docker.general.attempts")}
          </label>
        )}

        <span className="text-xs text-subtle">
          {t("docker.general.restartCount", { count: restartCount })}
        </span>
        {saved && <span className="text-xs text-ok">{t("docker.general.applied")}</span>}
      </div>

      {error && <p className="mt-1.5 text-xs text-danger">{error}</p>}

      <p className="mt-2 text-xs text-subtle">
        {t("docker.general.restartNote")}
        {composeProject && (
          <>
            {" "}
            <Rich
              text={t("docker.general.restartComposeNote")}
              values={{
                project: <span className="font-medium">{composeProject}</span>,
                cmd: <code className="font-mono">compose up</code>,
              }}
            />
          </>
        )}
      </p>
    </Section>
  );
}

function RunbookSection({
  containerId,
  containerName,
  initial,
  canAct,
}: {
  containerId: string;
  containerName: string;
  initial: Runbook | null;
  canAct: boolean;
}) {
  const t = useT();
  const f = useFormat();
  const [runbook, setRunbook] = useState(initial);
  const [editing, setEditing] = useState(initial === null);
  const [draft, setDraft] = useState(initial?.body ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/docker/${encodeURIComponent(containerId)}/runbook`, {
        method: "PUT",
        headers: { "content-type": "application/json", [CSRF_HEADER]: readCsrfToken() },
        body: JSON.stringify({ body: draft }),
      });
      const payload = await response.json();
      if (!response.ok) {
        setError(payload.error ?? t("common.errors.notSaved"));
        return;
      }
      setRunbook(payload.runbook as Runbook | null);
      setEditing(payload.runbook === null);
    } catch {
      setError(t("common.errors.network"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section
      title={t("docker.general.runbook")}
      action={
        canAct && !editing ? (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="flex items-center gap-1 text-xs text-subtle transition-colors hover:text-brand"
          >
            <Pencil className="size-3.5" /> {t("docker.general.edit")}
          </button>
        ) : null
      }
    >
      {editing ? (
        <>
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            disabled={!canAct || busy}
            rows={8}
            placeholder={t("docker.general.runbookPlaceholder", { name: containerName })}
            className="w-full rounded-md border border-line bg-canvas p-2.5 font-mono text-[12px] outline-none focus:border-brand disabled:opacity-50"
          />
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void save()}
              disabled={!canAct || busy}
              className="rounded-md border border-brand px-3 py-1.5 text-xs text-brand transition-colors hover:bg-brand/10 disabled:opacity-50"
            >
              {busy ? t("docker.general.saving") : t("common.actions.save")}
            </button>
            {runbook && (
              <button
                type="button"
                onClick={() => {
                  setDraft(runbook.body);
                  setEditing(false);
                }}
                className="rounded-md border border-line px-3 py-1.5 text-xs text-subtle transition-colors hover:text-ink"
              >
                {t("common.actions.cancel")}
              </button>
            )}
            <span className="text-[11px] text-subtle">
              {t("docker.general.markdownHint")}
            </span>
          </div>
          {error && <p className="mt-1.5 text-xs text-danger">{error}</p>}
        </>
      ) : runbook ? (
        <>
          <Markdown source={runbook.body} />
          <p className="mt-2 text-[11px] text-subtle">
            {t("docker.general.runbookMeta", {
              date: f.dateTime(runbook.updatedAt * 1000),
              user: runbook.updatedBy,
            })}
          </p>
        </>
      ) : (
        <p className="flex items-center gap-1.5 text-sm text-subtle">
          <BookText className="size-4" aria-hidden />
          {t("docker.general.noRunbook")}
        </p>
      )}
    </Section>
  );
}
