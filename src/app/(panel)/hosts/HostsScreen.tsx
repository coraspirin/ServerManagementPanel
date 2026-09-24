"use client";

import { useEffect, useState } from "react";
import { HardDrive, MonitorSmartphone, Server } from "lucide-react";
import type { HostView } from "@/lib/hosts/view";
import { formatDateTime } from "@/lib/i18n/format";
import { useDict, useDynamicT, useT } from "@/lib/i18n/client";

const STATUS_STYLE: Record<HostView["status"], string> = {
  online: "bg-ok/15 text-ok",
  offline: "bg-danger/15 text-danger",
  incompatible: "bg-warn/15 text-warn",
  pending: "bg-warn/15 text-warn",
  unknown: "bg-line text-subtle",
};

const REFRESH_MS = 15_000;

export function HostsScreen({
  initial,
  canManage,
}: {
  initial: HostView[];
  canManage: boolean;
}) {
  const t = useT();
  const tk = useDynamicT();
  const dict = useDict();
  const [hosts, setHosts] = useState(initial);

  // Heartbeat 15 sn'de bir yazıyor; liste aynı sıklıkta tazelenir.
  useEffect(() => {
    const timer = setInterval(async () => {
      const response = await fetch("/api/hosts", { cache: "no-store" }).catch(() => null);
      if (response?.ok) setHosts(((await response.json()) as { hosts: HostView[] }).hosts);
    }, REFRESH_MS);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="space-y-4">
      <p className="text-sm text-subtle">{t("hosts.screen.intro")}</p>

      <div className="overflow-x-auto rounded-lg border border-line bg-surface">
        <table className="rtable w-full min-w-[720px] text-sm">
          <thead className="border-b border-line text-left text-xs uppercase tracking-wide text-subtle">
            <tr>
              <th className="px-4 py-2.5 font-medium">{t("hosts.screen.colName")}</th>
              <th className="px-4 py-2.5 font-medium">{t("hosts.screen.colStatus")}</th>
              <th className="px-4 py-2.5 font-medium">{t("hosts.screen.colConnection")}</th>
              <th className="px-4 py-2.5 font-medium">{t("hosts.screen.colSystem")}</th>
              <th className="px-4 py-2.5 font-medium">{t("hosts.screen.colLastSeen")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {hosts.map((host) => {
              const Icon =
                host.agentType === "local" ? Server : host.agentType === "mock" ? MonitorSmartphone : HardDrive;
              return (
                <tr key={host.id} className={host.enabled ? "" : "opacity-50"}>
                  <td data-label="" className="px-4 py-3">
                    <div className="flex items-center gap-2 font-medium">
                      <Icon className="size-4 shrink-0 text-subtle" aria-hidden />
                      {host.name}
                    </div>
                    <div className="text-xs text-subtle">{tk(`hosts.agentType.${host.agentType}`)}</div>
                    {host.lastError && host.status !== "online" && (
                      <div className="mt-1 text-xs text-danger">{host.lastError}</div>
                    )}
                  </td>
                  <td data-label={t("hosts.screen.colStatus")} className="px-4 py-3">
                    <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${STATUS_STYLE[host.status]}`}>
                      {host.enabled ? tk(`hosts.status.${host.status}`) : t("hosts.screen.disabled")}
                    </span>
                    {host.latencyMs !== null && host.status === "online" && !host.isLocal && (
                      <span className="ml-2 text-xs text-subtle">{host.latencyMs} ms</span>
                    )}
                  </td>
                  <td data-label={t("hosts.screen.colConnection")} className="px-4 py-3 font-mono text-xs text-subtle">
                    {host.agentUrl ?? "—"}
                    {host.agentVersion && <div>v{host.agentVersion}</div>}
                  </td>
                  <td data-label={t("hosts.screen.colSystem")} className="px-4 py-3 text-xs text-subtle">
                    {host.hostname ?? "—"}
                    {host.osName && <div>{host.osName}</div>}
                  </td>
                  <td data-label={t("hosts.screen.colLastSeen")} className="px-4 py-3 text-xs text-subtle">
                    {host.isLocal ? "—" : host.lastSeen ? formatDateTime(host.lastSeen * 1000, dict) : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {canManage && <p className="text-xs text-subtle">{t("hosts.screen.manageSoon")}</p>}
    </div>
  );
}
