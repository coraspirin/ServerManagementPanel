import { appVersion } from "@/lib/env";
import { compareTags } from "@/lib/selfupdate/plan";
import type { Host, HostAgentType, HostCapabilities, HostStatus } from "./types";

/**
 * Sunucunun istemciye/API'ye giden hâli. Sır (`token_enc`) ve TLS parmak izi
 * burada YOK — liste ekranı ve seçici bunlara ihtiyaç duymaz.
 */
export type HostView = {
  id: number;
  name: string;
  agentType: HostAgentType;
  isLocal: boolean;
  enabled: boolean;
  status: HostStatus;
  agentUrl: string | null;
  pinned: boolean;
  lastSeen: number | null;
  latencyMs: number | null;
  lastError: string | null;
  agentVersion: string | null;
  /** Ajan merkezden eskiyse çekileceği sürüm etiketi (`v1.12.6`), değilse null. */
  updateTarget: string | null;
  capabilities: HostCapabilities;
  hostname: string | null;
  osName: string | null;
  color: string | null;
};

/**
 * Ajanın çekileceği sürüm: her zaman merkezin kendi sürümü (GitHub'daki en
 * yenisi değil) — ajan ile merkez aynı kodu çalıştırmalı. Ajan güncelse null.
 */
export function agentUpdateTarget(host: Pick<Host, "agentVersion">): string | null {
  if (!host.agentVersion) return null;
  const target = `v${appVersion()}`;
  return compareTags(target, host.agentVersion) > 0 ? target : null;
}

export function toHostView(host: Host): HostView {
  return {
    id: host.id,
    name: host.name,
    agentType: host.agentType,
    isLocal: host.isLocal,
    enabled: host.enabled,
    status: host.status,
    agentUrl: host.agentUrl,
    pinned: host.certFingerprint !== null,
    lastSeen: host.lastSeen,
    latencyMs: host.latencyMs,
    lastError: host.lastError,
    agentVersion: host.agentVersion,
    updateTarget: host.agentType === "agent" ? agentUpdateTarget(host) : null,
    capabilities: host.capabilities,
    hostname: host.hostname,
    osName: host.osName,
    color: host.color,
  };
}
