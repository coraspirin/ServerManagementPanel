/**
 * Çoklu sunucu — ortak tipler. Saf modül (testlerden import edilir).
 */

/** Sunucuya nasıl erişildiği. */
export type HostAgentType =
  /** Panelin kendi sunucusu: bind mount + docker.sock + helper soketi. */
  | "local"
  /** Uzak sunucu: panel-agent üzerinden imzalı RPC. */
  | "agent"
  /** MOCK_MODE'da üretilen sahte sunucu. */
  | "mock";

export type HostStatus = "unknown" | "pending" | "online" | "offline" | "incompatible";

export type Host = {
  id: number;
  name: string;
  address: string | null;
  agentType: HostAgentType;
  isLocal: boolean;
  enabled: boolean;
  status: HostStatus;
  /** Uzak ajanın adresi (https://adres:port). Yerel sunucuda null. */
  agentUrl: string | null;
  certFingerprint: string | null;
  lastSeen: number | null;
  latencyMs: number | null;
  lastError: string | null;
  agentVersion: string | null;
  protocol: number | null;
  capabilities: HostCapabilities;
  hostname: string | null;
  osName: string | null;
  sortOrder: number;
  color: string | null;
  createdAt: number;
};

/**
 * Ajanın o sunucuda erişebildikleri. Yerel sunucu için hepsi true sayılır;
 * gerçek durum yine ilgili modülün kendi kontrolüyle (ör. `helperConfigured`)
 * belirlenir.
 */
export type HostCapabilities = {
  docker?: boolean;
  helper?: boolean;
  hostRoot?: boolean;
  reports?: boolean;
};

/** Seçili sunucunun taşındığı yerler. */
export const HOST_COOKIE = "panel_host";
export const HOST_HEADER = "x-panel-host";
export const HOST_QUERY = "host";
