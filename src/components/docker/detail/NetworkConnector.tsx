"use client";

import { useEffect, useState } from "react";
import { Plus, X } from "lucide-react";

import { CSRF_HEADER } from "@/lib/auth/types";
import type { DockerNetwork } from "@/lib/providers/types";
import { useT } from "@/lib/i18n/client";

import { readCsrfToken, Section } from "./shared";

/**
 * Compose dışı bir container'ı ağlara bağlar / ağlardan çıkarır — Docker
 * API'siyle, ANINDA (`docker network connect/disconnect`).
 *
 * Yalnızca compose'a ait OLMAYAN container'da: compose'un yönettiği bir
 * container'da bu değişiklik ilk `compose up`'ta geri alınır, orada ağlar
 * compose dosyasında düzenleniyor (aynı sekmedeki compose bölümü). Ağlar
 * sayfasındaki bağlama ile aynı uç kullanılıyor.
 */
export function NetworkConnector({
  containerId,
  containerName,
  attached,
  onChanged,
}: {
  containerId: string;
  containerName: string;
  attached: string[];
  onChanged: () => void;
}) {
  const t = useT();
  const [networks, setNetworks] = useState<DockerNetwork[] | null>(null);
  const [choice, setChoice] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch("/api/docker/resources", {
          signal: controller.signal,
          cache: "no-store",
        });
        const payload = (await response.json()) as { networks?: DockerNetwork[]; error?: string };
        if (response.ok) setNetworks(payload.networks ?? []);
        else setError(payload.error ?? t("docker.networkTab.loadFailed"));
      } catch {
        if (!controller.signal.aborted) setError(t("common.errors.network"));
      }
    })();
    return () => controller.abort();
  }, [t]);

  async function run(action: "network-connect" | "network-disconnect", network: string) {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/docker/resources", {
        method: "POST",
        headers: { "content-type": "application/json", [CSRF_HEADER]: readCsrfToken() },
        body: JSON.stringify({ action, id: network, container: containerId }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        setError(payload.error ?? t("common.errors.actionFailed"));
        return;
      }
      setChoice("");
      onChanged();
    } catch {
      setError(t("common.errors.network"));
    } finally {
      setBusy(false);
    }
  }

  // `host`/`none` ağlarına sonradan bağlanılamaz; Docker reddeder.
  const candidates = (networks ?? []).filter(
    (network) => !attached.includes(network.name) && network.name !== "host" && network.name !== "none",
  );

  return (
    <Section title={t("docker.networkTab.editTitle")}>
      {error && <p className="mb-2 rounded bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}

      {attached.length === 0 ? (
        <p className="mb-2 text-sm text-subtle">—</p>
      ) : (
        <ul className="mb-3 flex flex-wrap gap-1.5">
          {attached.map((network) => (
            <li
              key={network}
              className="flex items-center gap-1 rounded border border-line py-0.5 pl-1.5 pr-0.5 font-mono text-[11px]"
            >
              {network}
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  if (confirm(t("docker.networkTab.confirmDisconnect", { network, container: containerName }))) {
                    void run("network-disconnect", network);
                  }
                }}
                aria-label={t("docker.networkTab.disconnect", { network })}
                title={t("docker.networkTab.disconnect", { network })}
                className="rounded p-0.5 text-subtle transition-colors hover:text-danger disabled:opacity-50"
              >
                <X className="size-3" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <select
          value={choice}
          disabled={busy || networks === null || candidates.length === 0}
          onChange={(event) => setChoice(event.target.value)}
          aria-label={t("docker.networkTab.pick")}
          className="min-w-0 max-w-full rounded-md border border-line bg-canvas px-2 py-1 font-mono text-xs outline-none focus:border-brand disabled:opacity-50"
        >
          <option value="">
            {networks === null
              ? t("common.states.loadingInline")
              : candidates.length === 0
                ? t("docker.networkTab.noCandidates")
                : t("docker.networkTab.pick")}
          </option>
          {candidates.map((network) => (
            <option key={network.id} value={network.name}>
              {network.name} ({network.driver})
            </option>
          ))}
        </select>
        <button
          type="button"
          disabled={busy || !choice}
          onClick={() => void run("network-connect", choice)}
          className="flex items-center gap-1 rounded-md border border-line px-2.5 py-1 text-xs transition-colors hover:border-brand hover:text-brand disabled:opacity-50"
        >
          <Plus className="size-3" /> {t("docker.networkTab.connect")}
        </button>
      </div>
      <p className="mt-2 text-[11px] text-subtle">{t("docker.networkTab.liveNote")}</p>
    </Section>
  );
}
