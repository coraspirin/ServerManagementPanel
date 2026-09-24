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
  capabilities: HostCapabilities;
  hostname: string | null;
  osName: string | null;
  color: string | null;
};

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
    capabilities: host.capabilities,
    hostname: host.hostname,
    osName: host.osName,
    color: host.color,
  };
}
