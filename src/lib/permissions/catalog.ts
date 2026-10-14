import type { PermissionKey } from "../auth/types.ts";
import { buildHint, type HintHost, type HintTranslate, type PermissionHint } from "./hint.ts";

/**
 * Özellik → gereksinim kataloğu (kararlar.md D6) — TEK dosya, saf modül.
 *
 * Her satır bir ekranın (ya da ekran içindeki ayrı bir yeteneğin) neye
 * ihtiyaç duyduğunu söyler: panel izni, sunucudaki mount'lar, host-helper
 * eylemleri, yalnız yerel olup olmadığı. `/yetki-yok` bir iznin hangi
 * ekranları açtığını, `/hosts` yetki yoklaması bir sunucuda hangi
 * özelliklerin çalıştığını buradan hesaplar.
 *
 * Yeni sayfa/uç eklerken buraya satır ekle (bkz. _Claude/tarifler.md).
 */

/** Sunucu tarafı yetenekler — ajanın `agent.hello` capabilities'i + /host/proc. */
export type Capability = "docker" | "proc" | "hostRoot" | "helper";

export type FeatureEntry = {
  key: string;
  route: string;
  permission: PermissionKey;
  /** Yoksa özellik çalışmaz (🔴). */
  requires?: Capability[];
  /** Yoksa özellik kısmen çalışır (🟡). */
  optional?: Capability[];
  /** Kullandığı host-helper eylemleri — izin listesinde olmalı. */
  helperActions?: string[];
  /** Yalnızca panelin çalıştığı sunucuda (uzakta 501). */
  localOnly?: boolean;
  /**
   * Uzakta kullandığı ajan op'ları. Ajan op listesini bildiriyorsa (native
   * ajan, `capabilities.ops`) eksik olan özelliği kapatır (🔴). Node ajanı
   * liste bildirmez; orada bu alan yok sayılır.
   */
  ops?: string[];
};

export const FEATURE_CATALOG: readonly FeatureEntry[] = [
  { key: "docker", route: "/docker", permission: "docker.view", requires: ["docker"], ops: ["docker.api"] },
  {
    key: "stacks",
    route: "/docker?tab=stack",
    permission: "apps.install",
    requires: ["docker", "helper"],
    // `agent.image`: compose dosyaları sunucunun panel imajıyla açılan geçici
    // container'da yazılıyor (appstore/install, compose/edit). Native ajanda
    // imaj yok → yığın kurulumu/düzenlemesi şimdilik 🔴 (yarıda kırılmasın).
    ops: ["docker.api", "helper.call", "agent.image"],
    helperActions: ["compose.ps", "compose.config", "compose.up", "compose.pull", "compose.restart", "compose.down"],
  },
  { key: "database", route: "/database", permission: "db.read", requires: ["docker"], optional: ["hostRoot"], ops: ["db.query"] },
  { key: "files", route: "/files", permission: "files.read", requires: ["hostRoot"], optional: ["docker"], ops: ["files.list"] },
  { key: "backup", route: "/backup", permission: "backup.manage", requires: ["docker", "hostRoot"], ops: ["docker.api"] },
  { key: "monitoring", route: "/monitoring", permission: "metrics.view", requires: ["proc"], ops: ["metrics.sample"] },
  {
    key: "logs",
    route: "/logs",
    permission: "logs.view",
    optional: ["docker", "helper"],
    helperActions: ["journal.read", "journal.errors"],
  },
  {
    key: "hostServices",
    route: "/host",
    permission: "host.service",
    requires: ["helper"],
    ops: ["helper.call"],
    helperActions: ["service.list", "service.status", "service.restart", "service.start", "service.stop"],
  },
  {
    key: "hostPower",
    route: "/host",
    permission: "host.power",
    requires: ["helper"],
    ops: ["helper.call"],
    helperActions: ["power.reboot", "power.shutdown", "power.cancel"],
  },
  { key: "hostShell", route: "/host", permission: "host.shell", requires: ["helper"], ops: ["helper.call"], helperActions: ["shell.preset", "shell.exec"] },
  { key: "ports", route: "/ports", permission: "security.view", requires: ["proc"] },
  {
    key: "fail2ban",
    route: "/security",
    permission: "security.view",
    requires: ["helper"],
    helperActions: ["fail2ban.status", "fail2ban.jail", "fail2ban.unban"],
    localOnly: true,
  },
  { key: "vulnScan", route: "/security", permission: "security.view", requires: ["docker"], localOnly: true },
  { key: "hostcron", route: "/hostcron", permission: "cron.manage", requires: ["docker", "hostRoot"], localOnly: true },
  { key: "network", route: "/network", permission: "network.manage", requires: ["proc"], localOnly: true },
];

export function featuresForPermission(permission: string): FeatureEntry[] {
  return FEATURE_CATALOG.filter((entry) => entry.permission === permission);
}

export type FeatureHost = HintHost & {
  capabilities: Record<Capability, boolean>;
  /** Ajanın bildirdiği op listesi (native ajan); null/yok = hepsi var sayılır. */
  ops?: readonly string[] | null;
  /**
   * Native ajan: politikada açık helper eylemleri. Varsa helper eylemleri
   * "doğrulanamadı" (🟡) yerine kesin: hepsi açık ✅, biri kapalı 🟡/🔴.
   */
  helperActions?: readonly string[] | null;
};

export type FeatureState = "ok" | "partial" | "off";

export type FeatureEvaluation = { key: string; route: string; state: FeatureState; hints: PermissionHint[] };

const MISSING_HINT = {
  docker: "dockerMissing",
  proc: "procMissing",
  hostRoot: "hostRootMissing",
  helper: "helperMissing",
} as const;

/**
 * Bir özelliğin bir sunucudaki durumu:
 *  - yalnız yerel özellik + uzak sunucu, ya da zorunlu yetenek eksik → 🔴
 *  - isteğe bağlı yetenek eksik → 🟡
 *  - helper eylemi gerekiyor ve helper kurulu → 🟡 "doğrulanamadı": izin
 *    listesi host'ta ve panel onu okuyamaz (bilinçli sınır); eklenmesi
 *    gereken satırlar ipucunda (ajan policy bilgisi Faz B'de gelince netleşir)
 *  - aksi hâlde ✅
 */
export function evaluateFeature(entry: FeatureEntry, host: FeatureHost, t: HintTranslate): FeatureEvaluation {
  const base = { key: entry.key, route: entry.route };
  const ctx = { host, feature: entry.key };

  if (entry.localOnly && !host.local) {
    return { ...base, state: "off", hints: [buildHint("unsupported", ctx, t)] };
  }

  const offered = host.ops;
  if (offered && (entry.ops ?? []).some((op) => !offered.includes(op))) {
    return { ...base, state: "off", hints: [buildHint("agentOpMissing", ctx, t)] };
  }

  const missingRequired = (entry.requires ?? []).filter((cap) => !host.capabilities[cap]);
  if (missingRequired.length > 0) {
    return { ...base, state: "off", hints: missingRequired.map((cap) => buildHint(MISSING_HINT[cap], ctx, t)) };
  }

  const hints: PermissionHint[] = (entry.optional ?? [])
    .filter((cap) => !host.capabilities[cap])
    .map((cap) => buildHint(MISSING_HINT[cap], ctx, t));

  const usesHelper = (entry.helperActions?.length ?? 0) > 0 && host.capabilities.helper;
  if (usesHelper && host.helperActions) {
    // Native ajan politikasını bildiriyor: hangi eylemin kapalı olduğu belli.
    const enabled = host.helperActions;
    const missing = (entry.helperActions ?? []).filter((action) => !enabled.includes(action));
    if (missing.length === (entry.helperActions ?? []).length) {
      return { ...base, state: "off", hints: [...hints, buildHint("policyMissing", { ...ctx, allowLines: missing }, t)] };
    }
    if (missing.length > 0) {
      hints.push(buildHint("policyMissing", { ...ctx, allowLines: missing }, t));
    }
  } else if (usesHelper) {
    hints.push(buildHint("helperUnverified", { ...ctx, allowLines: entry.helperActions }, t));
  }

  return { ...base, state: hints.length > 0 ? "partial" : "ok", hints };
}

export function evaluateHost(host: FeatureHost, t: HintTranslate): FeatureEvaluation[] {
  return FEATURE_CATALOG.map((entry) => evaluateFeature(entry, host, t));
}
