"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Server } from "lucide-react";
import { useDynamicT, useT } from "@/lib/i18n/client";
import { useHosts, type HostSummary } from "./HostContext";

const COOKIE = "panel_host";

const STATUS_DOT: Record<HostSummary["status"], string> = {
  online: "bg-ok",
  offline: "bg-danger",
  incompatible: "bg-warn",
  pending: "bg-warn",
  unknown: "bg-subtle",
};

/**
 * Üst bardaki sunucu seçici. Tek sunucuda hiç görünmez.
 *
 * Seçim çereze yazılır ve sayfa sunucuda yeniden çizilir (`router.refresh`):
 * ekranların ilk verisi server component'lerde hazırlanıyor, istemci tarafında
 * sunucu değiştirmek her ekranın kendi yükleme mantığını bilmeyi gerektirirdi.
 */
export function HostSelector() {
  const t = useT();
  const tk = useDynamicT();
  const router = useRouter();
  const { hosts, current, multi } = useHosts();
  const [pending, startTransition] = useTransition();

  if (!multi) return null;

  function select(id: number) {
    document.cookie = `${COOKIE}=${id}; path=/; max-age=31536000; samesite=lax`;
    startTransition(() => router.refresh());
  }

  return (
    <label
      className={`flex min-w-0 items-center gap-1.5 rounded-md border border-line px-2 py-1 text-sm ${
        pending ? "opacity-60" : ""
      }`}
      title={t("shell.hostSelector.title")}
    >
      <Server className="size-4 shrink-0 text-subtle" aria-hidden />
      <span className={`size-2 shrink-0 rounded-full ${STATUS_DOT[current.status]}`} aria-hidden />
      <span className="sr-only">{t("shell.hostSelector.label")}</span>
      <select
        value={current.id}
        disabled={pending}
        onChange={(event) => select(Number(event.target.value))}
        className="min-w-0 max-w-[10rem] truncate bg-transparent font-medium outline-none"
      >
        {hosts.map((host) => (
          <option key={host.id} value={host.id}>
            {host.name}
            {host.status === "online" ? "" : ` — ${tk(`hosts.status.${host.status}`)}`}
          </option>
        ))}
      </select>
    </label>
  );
}
