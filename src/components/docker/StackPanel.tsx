"use client";

import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Download,
  Plus,
  FileCode2,
  Play,
  RotateCw,
  Square,
} from "lucide-react";

import { ContainerRow, type RowHandlers } from "./ContainerRow";
import { ComposeSection } from "./ComposeSection";
import { StackInstaller } from "./StackInstaller";
import { readCsrfToken } from "./detail/shared";
import { CSRF_HEADER } from "@/lib/auth/types";
import { formatBytes } from "@/lib/metrics/catalog";
import { useFormat, useT } from "@/lib/i18n/client";
import type { MessageKey } from "@/lib/i18n/translate";
import type { StackRow } from "@/lib/docker/stacks";
import type { ContainerView } from "@/lib/docker/types";

/**
 * Compose yığınları sekmesi (M3.37).
 *
 * ## Neden ayrı bir sekme
 *
 * İlk tasarım container listesini yığına göre gruplamaktı; kullanıcı reddetti
 * ve gerekçesi doğruydu: sunucudaki 13 compose projesinin 8'i tek
 * container'lık. Compose ile başlatılmış olmak bir uygulamayı yığın yapmıyor
 * ve *"defterim, home assistant, zigbee2mqtt aynı şey değil ki gruplansın"*.
 * Container listesi düz kaldı, yığın yönetimi buraya taşındı.
 *
 * ## Neden yeni bir özellik değil
 *
 * Yığına dokunan her parça zaten yazılmıştı ama ÜÇ yere dağılmıştı:
 * `/appstore` (kurulum), `/host` (compose komutları) ve container popup'ı
 * (tek servisin düzenlenmesi). Bu sekme onları tek adrese getiriyor; altındaki
 * uçlar aynı uçlar.
 *
 * Üyeler `ContainerRow` ile çiziliyor — Container sekmesindeki satırın birebir
 * aynısı. İki yerde iki farklı container görünümü öğretmenin anlamı yok.
 */

type Payload = {
  stacks: StackRow[];
  containers: ContainerView[];
  helperReady: boolean;
};

/** Compose komutları — `/api/host/compose`'un kabul ettiği eylemler. */
const KOMUTLAR: {
  action: string;
  labelKey: MessageKey;
  icon: typeof Download;
  danger: boolean;
}[] = [
  { action: "compose.pull", labelKey: "docker.stacks.cmd.pull", icon: Download, danger: false },
  { action: "compose.up", labelKey: "docker.stacks.cmd.up", icon: Play, danger: false },
  { action: "compose.restart", labelKey: "docker.stacks.cmd.restart", icon: RotateCw, danger: false },
  { action: "compose.down", labelKey: "docker.stacks.cmd.down", icon: Square, danger: true },
];

export function StackPanel({
  query,
  visible,
  publicHost,
  canAct,
  canExec,
  canService,
  canInstall,
  rowHandlers,
  refreshToken,
}: {
  /** Ortak araç çubuğundan gelen arama metni. */
  query: string;
  visible: ReadonlySet<string>;
  publicHost: string;
  canAct: boolean;
  canExec: boolean;
  /** `host.service` — compose komutları bu izne bağlı. */
  canService: boolean;
  /** `apps.install` — yeni yığın kurma bu izne bağlı. */
  canInstall: boolean;
  rowHandlers: RowHandlers;
  /** Değiştiğinde liste yeniden çekilir (araç çubuğundaki Yenile). */
  refreshToken: number;
}) {
  const t = useT();
  const f = useFormat();
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [sonuc, setSonuc] = useState<{ stack: string; ok: boolean; text: string } | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [kurulum, setKurulum] = useState(false);

  const apply = useCallback((payload: Payload & { error?: string }, ok: boolean) => {
    if (ok) {
      setData(payload);
      setError(null);
    } else {
      setError(payload.error ?? t("docker.stacks.loadFailed"));
    }
  }, [t]);

  useEffect(() => {
    const controller = new AbortController();

    (async () => {
      try {
        const response = await fetch("/api/docker/stacks", {
          cache: "no-store",
          signal: controller.signal,
        });
        apply(await response.json(), response.ok);
      } catch (fetchError) {
        if ((fetchError as Error)?.name !== "AbortError") setError(t("common.errors.network"));
      }
    })();

    return () => controller.abort();
  }, [apply, refreshToken, t]);

  const tazele = useCallback(async () => {
    try {
      const response = await fetch("/api/docker/stacks", { cache: "no-store" });
      if (response.ok) setData((await response.json()) as Payload);
    } catch {
      // Tazeleme başarısızsa ekrandaki liste duruyor; Yenile düğmesi var.
    }
  }, []);

  const toggle = (name: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (!next.delete(name)) next.add(name);
      return next;
    });

  async function run(stack: StackRow, action: string, label: string) {
    if (!stack.workingDir) return;
    if (!confirm(t("docker.stacks.confirm", { stack: stack.name, action: f.lower(label) }))) return;

    setBusy(`${stack.name}:${action}`);
    setSonuc(null);
    try {
      const response = await fetch("/api/host/compose", {
        method: "POST",
        headers: { "content-type": "application/json", [CSRF_HEADER]: readCsrfToken() },
        body: JSON.stringify({ action, dir: stack.workingDir }),
      });
      const payload = (await response.json()) as { output?: string; error?: string };
      setSonuc({
        stack: stack.name,
        ok: response.ok,
        text: response.ok
          ? payload.output?.trim() || t("docker.stacks.done", { action: label })
          : (payload.error ?? t("common.errors.actionFailed")),
      });

      // Durum değişti; liste yeniden çekiliyor.
      await tazele();
    } catch {
      setSonuc({ stack: stack.name, ok: false, text: t("common.errors.network") });
    } finally {
      setBusy(null);
    }
  }

  if (error) return <p className="text-sm text-danger">{error}</p>;
  if (!data) return <p className="text-sm text-subtle">{t("common.states.loadingInline")}</p>;

  const q = f.lower(query.trim());

  /*
    Arama YALNIZCA satırları süzüyor; yığının "2/3" sayısı süzülmemiş veriden
    geliyor ve aramayla değişmiyor. Aksi halde arama kutusuna yazmak panelin
    "kaç container çalışıyor" cevabını değiştirirdi.
  */
  const stacks = q
    ? data.stacks.filter((stack) => f.lower(stack.name).includes(q))
    : data.stacks;

  const uyeleri = (stack: StackRow) =>
    data.containers.filter((container) => container.composeProject === stack.name);

  return (
    <div className="space-y-3">
      {canInstall && (
        <div>
          <button
            type="button"
            onClick={() => setKurulum((value) => !value)}
            className="inline-flex items-center gap-1 rounded-md border border-line px-2.5 py-1.5 text-xs text-subtle transition-colors hover:border-brand hover:text-brand"
          >
            <Plus className="size-3.5" aria-hidden />
            {kurulum ? t("docker.stacks.closeInstall") : t("docker.stacks.newStack")}
          </button>
        </div>
      )}

      {canInstall && kurulum && (
        <StackInstaller
          onInstalled={() => {
            void tazele();
          }}
        />
      )}

      {stacks.length === 0 ? (
        <p className="rounded-lg border border-dashed border-line bg-surface px-5 py-8 text-center text-sm text-subtle">
          {data.stacks.length === 0 ? t("docker.stacks.none") : t("docker.stacks.noMatch")}
        </p>
      ) : (
        <div className="divide-y divide-line rounded-lg border border-line bg-surface">
          {stacks.map((stack) => {
            const acik = open.has(stack.name);
            const members = uyeleri(stack);
            const komutlarAcik = canService && data.helperReady && stack.workingDir !== null;

            return (
              <div key={stack.name}>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-3">
                  <button
                    type="button"
                    onClick={() => toggle(stack.name)}
                    className="flex min-w-0 items-center gap-1.5 text-left transition-colors hover:text-brand"
                  >
                    {acik ? (
                      <ChevronDown className="size-3.5 shrink-0" aria-hidden />
                    ) : (
                      <ChevronRight className="size-3.5 shrink-0" aria-hidden />
                    )}
                    <span className="truncate font-medium">{stack.name}</span>
                  </button>

                  <span
                    className="rounded border border-line px-1.5 py-0.5 text-[10px] text-subtle"
                    title={
                      stack.source === "panel"
                        ? t("docker.stacks.sourcePanelTitle")
                        : t("docker.stacks.sourceExternalTitle")
                    }
                  >
                    {stack.source === "panel"
                      ? t("docker.stacks.sourcePanel")
                      : t("docker.stacks.sourceExternal")}
                  </span>

                  <span
                    className={`text-xs ${
                      stack.total === 0
                        ? "text-warn"
                        : stack.running === stack.total
                          ? "text-ok"
                          : "text-warn"
                    }`}
                  >
                    {stack.total === 0
                      ? t("docker.stacks.noContainers")
                      : t("docker.stacks.runningCount", {
                          running: stack.running,
                          total: stack.total,
                        })}
                  </span>

                  {stack.cpuPct !== null && (
                    <span className="text-xs text-subtle">{f.pct(stack.cpuPct)}</span>
                  )}
                  {stack.memUsed !== null && (
                    <span className="text-xs text-subtle">{formatBytes(stack.memUsed)}</span>
                  )}

                  <span
                    className="truncate font-mono text-[11px] text-subtle"
                    title={stack.workingDir ?? t("docker.stacks.dirMissingTitle")}
                  >
                    {stack.workingDir ?? t("docker.stacks.dirUnknown")}
                  </span>

                  <div className="ml-auto flex flex-wrap items-center gap-1">
                    {stack.workingDir && (
                      <button
                        type="button"
                        onClick={() => setEditing(editing === stack.name ? null : stack.name)}
                        disabled={members.length === 0}
                        title={
                          members.length === 0
                            ? t("docker.stacks.editDisabled")
                            : t("docker.stacks.editCompose")
                        }
                        className="inline-flex items-center gap-1 rounded-md border border-line px-2 py-1 text-xs text-subtle transition-colors hover:border-brand hover:text-brand disabled:opacity-40"
                      >
                        <FileCode2 className="size-3" aria-hidden />
                        {t("docker.stacks.composeButton")}
                      </button>
                    )}

                    {komutlarAcik &&
                      KOMUTLAR.map((komut) => (
                        <button
                          key={komut.action}
                          type="button"
                          disabled={busy !== null}
                          onClick={() => void run(stack, komut.action, t(komut.labelKey))}
                          className={`inline-flex items-center gap-1 rounded-md border border-line px-2 py-1 text-xs text-subtle transition-colors disabled:opacity-40 ${
                            komut.danger
                              ? "hover:border-danger hover:text-danger"
                              : "hover:border-brand hover:text-brand"
                          }`}
                        >
                          <komut.icon className="size-3" aria-hidden />
                          {busy === `${stack.name}:${komut.action}` ? "…" : t(komut.labelKey)}
                        </button>
                      ))}
                  </div>
                </div>

                {/*
                  Komutların neden çıkmadığı SÖYLENİYOR. Düğmeyi sessizce
                  gizlemek, kullanıcıyı "panel bunu neden yapmıyor" diye
                  aramaya bırakırdı.
                */}
                {stack.workingDir && !komutlarAcik && (
                  <p className="px-4 pb-2 text-[11px] text-subtle">
                    {!data.helperReady
                      ? t("docker.stacks.needHelper")
                      : t("docker.stacks.needPermission")}
                  </p>
                )}

                {!stack.workingDir && (
                  <p className="px-4 pb-2 text-[11px] text-subtle">
                    {t("docker.stacks.noWorkingDir")}
                  </p>
                )}

                {stack.lastError && (
                  <p className="flex items-start gap-1.5 px-4 pb-2 text-[11px] text-danger">
                    <AlertTriangle className="mt-0.5 size-3 shrink-0" aria-hidden />
                    <span>
                      {t("docker.stacks.lastError", {
                        action: stack.lastAction ?? "",
                        error: stack.lastError,
                      })}
                    </span>
                  </p>
                )}

                {sonuc?.stack === stack.name && (
                  <pre
                    className={`mx-4 mb-2 max-h-40 overflow-auto rounded border px-2 py-1.5 font-mono text-[11px] ${
                      sonuc.ok ? "border-line text-subtle" : "border-danger/40 text-danger"
                    }`}
                  >
                    {sonuc.text}
                  </pre>
                )}

                {editing === stack.name && members.length > 0 && (
                  <div className="border-t border-line px-4 py-3">
                    <ComposeSection
                      key={`${stack.name}-compose`}
                      containerId={members[0].id}
                      composeProject={stack.name}
                      canAct={canAct}
                    />
                  </div>
                )}

                {acik && (
                  <div className="overflow-x-auto border-t border-line">
                    {members.length === 0 ? (
                      <p className="px-4 py-3 text-xs text-subtle">
                        {t("docker.stacks.noMembers")}
                      </p>
                    ) : (
                      <table className="rtable w-full min-w-[52rem] text-sm">
                        <tbody className="divide-y divide-line">
                          {members.map((container) => (
                            <ContainerRow
                              key={container.id}
                              container={container}
                              visible={visible}
                              publicHost={publicHost}
                              canAct={canAct}
                              canExec={canExec}
                              busyId={null}
                              selected={false}
                              showSelect={false}
                              indent
                              handlers={rowHandlers}
                            />
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <p className="text-[11px] text-subtle">
        {t("docker.stacks.footer")}
      </p>
    </div>
  );
}
