import "server-only";

import { randomBytes } from "node:crypto";
import { agentCall, agentExchange, parseAgentUrl } from "@/lib/agent/client";
import {
  AGENT_PROTOCOL,
  verifyEnrollProof,
  type AgentHello,
  type EnrollResponse,
} from "@/lib/agent/protocol";
import { encryptSecret, generateToken, decryptSecret, type EncryptedValue } from "@/lib/crypto";
import { appVersion } from "@/lib/env";
import { serverT } from "@/lib/i18n/runtime";
import { dispatch } from "@/lib/notify";
import { compareTags } from "@/lib/selfupdate/plan";
import type { UpdateStatus } from "@/lib/selfupdate";
import { getBool } from "@/lib/settings";
import { runWithHost } from "./context";
import { isHostError } from "./errors";
import {
  getHost,
  hostNameTaken,
  hostTokenEnc,
  insertPendingHost,
  listHosts,
  markEnrolled,
  resetHostSecret,
  updateHostStatus,
} from "./store";
import type { Host } from "./types";
import { agentUpdateTarget } from "./view";

export { agentUpdateTarget };

/**
 * Uzak sunucu kaydı ve sağlık takibi (panel-agent).
 *
 * Akış:
 *  1. `createAgentHost` — satır + sır üretilir, kurulum metni BİR KEZ döner.
 *  2. Kullanıcı ajanı uzak sunucuda başlatır.
 *  3. `enrollAgentHost` — merkez ajana bağlanır, sertifika parmak izini
 *     kanıtla doğrular ve sabitler.
 *  4. `heartbeatAgents` — 15 sn'de bir durum/sürüm/gecikme günceller; ajan
 *     merkezden eski sürümdeyse (ayar açıksa) onu güncellemeyi tetikler.
 */

export const DEFAULT_AGENT_PORT = 7443;

/** Ajan imajı. Yayınlanan sürüm etiketi varsayılan; yerel yapımlar için ezilebilir. */
export function agentImage(): string {
  return process.env.AGENT_IMAGE ?? `ghcr.io/coraspirin/servermanagementpanel:${appVersion()}`;
}

const NAME_PATTERN = /^[\p{L}\p{N}][\p{L}\p{N} ._-]{0,39}$/u;

export function validateHostName(name: string, exceptId?: number): string | null {
  const trimmed = name.trim();
  if (!NAME_PATTERN.test(trimmed)) return serverT("hosts.validation.name");
  if (hostNameTaken(trimmed, exceptId)) return serverT("hosts.validation.nameTaken");
  return null;
}

export type InstallKit = {
  token: string;
  image: string;
  port: number;
  env: string;
  compose: string;
};

function installKit(token: string): InstallKit {
  const image = agentImage();
  const env = [
    `AGENT_TOKEN=${token}`,
    `AGENT_IMAGE=${image}`,
    "# getent group docker | cut -d: -f3",
    "DOCKER_GID=",
    "# host-helper: sudo host-helper/install.sh → HELPER_SECRET",
    "HELPER_SECRET=",
  ].join("\n");

  const compose = `services:
  panel-agent:
    image: \${AGENT_IMAGE}
    restart: unless-stopped
    group_add:
      - "\${DOCKER_GID:?DOCKER_GID}"
    environment:
      PANEL_ROLE: agent
      AGENT_TOKEN: \${AGENT_TOKEN:?AGENT_TOKEN}
      HELPER_SECRET: \${HELPER_SECRET:-}
      AGENT_PORT: "${DEFAULT_AGENT_PORT}"
    ports:
      - "${DEFAULT_AGENT_PORT}:${DEFAULT_AGENT_PORT}"
    volumes:
      - agent-data:/app/data
      - /var/run/docker.sock:/var/run/docker.sock
      - /run/panel-helper:/run/panel-helper
      - /proc:/host/proc:ro
      - /sys:/host/sys:ro
      - /:/host/root:ro,rslave
      - /etc/os-release:/host/etc/os-release:ro
      - /etc/hostname:/host/etc/hostname:ro
      - ./reports:/app/reports:ro

volumes:
  agent-data:
`;
  return { token, image, port: DEFAULT_AGENT_PORT, env, compose };
}

export function createAgentHost(name: string): { host: Host; kit: InstallKit } {
  const token = generateToken(32);
  const id = insertPendingHost(name.trim(), JSON.stringify(encryptSecret(token)));
  return { host: getHost(id) as Host, kit: installKit(token) };
}

/** Sırrı yeniler (ör. kurulum metni kaybolduysa). Ajan yeni sırla yeniden başlatılmalı. */
export function regenerateAgentKit(id: number): InstallKit | null {
  const host = getHost(id);
  if (!host || host.isLocal || host.agentType !== "agent") return null;
  const token = generateToken(32);
  resetHostSecret(id, JSON.stringify(encryptSecret(token)));
  return installKit(token);
}

function helloUpdate(hello: AgentHello, latencyMs: number) {
  return {
    status: hello.protocol === AGENT_PROTOCOL ? ("online" as const) : ("incompatible" as const),
    seen: true,
    latencyMs,
    lastError:
      hello.protocol === AGENT_PROTOCOL
        ? null
        : serverT("hosts.errors.protocolMismatch", { agent: hello.protocol, panel: AGENT_PROTOCOL }),
    agentVersion: hello.version,
    protocol: hello.protocol,
    capabilities: hello.capabilities,
    hostname: hello.hostname,
    osName: hello.osName,
  };
}

export type EnrollResult = { ok: true; host: Host } | { ok: false; error: string };

export async function enrollAgentHost(id: number, rawUrl: string): Promise<EnrollResult> {
  const host = getHost(id);
  if (!host || host.isLocal || host.agentType !== "agent") {
    return { ok: false, error: serverT("hosts.errors.unknown", { host: String(id) }) };
  }

  const target = parseAgentUrl(rawUrl);
  if (!target) return { ok: false, error: serverT("hosts.validation.agentUrl") };
  const agentUrl = `https://${target.hostname.includes(":") ? `[${target.hostname}]` : target.hostname}:${target.port}`;

  const encrypted = hostTokenEnc(id);
  if (!encrypted) return { ok: false, error: serverT("hosts.errors.authFailed") };
  const secret = decryptSecret(JSON.parse(encrypted) as EncryptedValue);

  const nonce = randomBytes(16).toString("hex");
  const started = Date.now();
  try {
    // Sabitleme YOK (henüz bilinmiyor): görülen parmak izi kanıtla doğrulanır.
    const exchange = await agentExchange(host, target, secret, null, "/api/agent/enroll", JSON.stringify({ nonce }), {
      timeoutMs: 15_000,
    });
    const chunks: Buffer[] = [];
    for await (const chunk of exchange.response) chunks.push(chunk as Buffer);
    const text = Buffer.concat(chunks).toString("utf8");

    if (exchange.status === 401) return { ok: false, error: serverT("hosts.errors.authFailed") };
    if (exchange.status !== 200) {
      return { ok: false, error: serverT("hosts.errors.enrollHttp", { status: exchange.status }) };
    }

    const reply = JSON.parse(text) as EnrollResponse;
    if (!verifyEnrollProof(secret, nonce, exchange.fingerprint, reply.proof)) {
      // Kanıt sırla üretildi ama BAŞKA bir sertifika için: arada biri var.
      return { ok: false, error: serverT("hosts.errors.pinMismatch") };
    }

    markEnrolled(id, {
      agentUrl,
      fingerprint: exchange.fingerprint,
      update: helloUpdate(reply.hello, Date.now() - started),
    });
    return { ok: true, host: getHost(id) as Host };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/** Yanıt alınamayan ajan bu kadar süre sonra çevrimdışı sayılır. */
const OFFLINE_AFTER_SECONDS = 45;

export type HeartbeatSummary = { checked: number; online: number; changed: string[] };

export async function heartbeatAgents(): Promise<HeartbeatSummary> {
  const agents = listHosts().filter(
    (host) => host.agentType === "agent" && host.enabled && host.certFingerprint !== null,
  );
  const changed: string[] = [];
  let online = 0;

  await Promise.all(
    agents.map(async (host) => {
      const started = Date.now();
      try {
        // Bilinen durumu "online" varsayarak çağır: sağlayıcı katmanı
        // çevrimdışı sunucuya istek atmıyor, ama heartbeat atmalı.
        const hello = await agentCall<AgentHello>({ ...host, status: "online" }, "agent.hello");
        const update = helloUpdate(hello, Date.now() - started);
        updateHostStatus(host.id, update);
        autoUpdate(host, hello.version);
        if (update.status === "online") online++;
        if (update.status !== host.status) changed.push(`${host.name}: ${update.status}`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const stale = (host.lastSeen ?? 0) < Math.floor(Date.now() / 1000) - OFFLINE_AFTER_SECONDS;
        const auth = isHostError(error) && (error.code === "authFailed" || error.code === "pinMismatch");
        const status = auth || stale ? "offline" : host.status;
        updateHostStatus(host.id, { status, lastError: message });
        if (status === "online") online++;
        if (status !== host.status) changed.push(`${host.name}: ${status}`);
      }
    }),
  );

  return { checked: agents.length, online, changed };
}

// --- ajan güncelleme ---------------------------------------------------------

/**
 * Bu özellikten eski ajanda elle güncelleme komutu (ajanın kurulum
 * dizininde). Bu bilgisayardan: `python agent-deploy.py <adres>`.
 */
export function manualAgentUpdateCommand(): string {
  return `sed -i 's#^AGENT_IMAGE=.*#AGENT_IMAGE=${agentImage()}#' .env && docker compose pull && docker compose up -d`;
}

function agentHost(id: number): Host {
  const host = getHost(id);
  if (!host || host.isLocal || host.agentType !== "agent" || !host.certFingerprint) {
    throw new Error(serverT("hosts.errors.unknown", { host: String(id) }));
  }
  // Durum bilerek "online" sayılıyor: güncellenmesi gereken ajan çoğu zaman
  // tam da "uyumsuz" düşmüş olandır (heartbeat de böyle çağırıyor).
  return { ...host, status: "online" };
}

/** Ajan `agent.update` bilmiyorsa (404) elle güncelleme gerektiğini anlatan hata. */
function updateError(error: unknown): Error {
  if (isHostError(error) && error.code === "incompatible") {
    return new Error(serverT("hosts.update.errors.tooOld"));
  }
  return error instanceof Error ? error : new Error(String(error));
}

/**
 * Ajana hedef etiketi bildirir; ajan sürümü GitHub'dan kendi kurulumuna göre
 * alır (GHCR imajı ya da kaynak arşivi) ve updater kendi sunucusunda sürer.
 */
export async function startAgentUpdate(id: number): Promise<string> {
  const host = agentHost(id);
  const tag = agentUpdateTarget(host);
  if (!tag) throw new Error(serverT("hosts.update.errors.upToDate"));
  try {
    await agentCall(host, "agent.update", [tag]);
  } catch (error) {
    throw updateError(error);
  }
  return tag;
}

export async function agentUpdateStatus(id: number): Promise<UpdateStatus> {
  try {
    return await agentCall<UpdateStatus>(agentHost(id), "agent.updateStatus");
  } catch (error) {
    throw updateError(error);
  }
}

/**
 * Otomatik güncelleme: host başına en son denenen etiket. Aynı sürüm bir kez
 * denenir — başarısız olursa her heartbeat'te yeniden denenmez (elle
 * butondan tekrar başlatılabilir). Süreç yeniden başlarsa bir kez daha denenir.
 */
const autoAttempts = new Map<number, string>();

function autoUpdate(host: Host, version: string) {
  const attempted = autoAttempts.get(host.id);
  if (attempted && compareTags(attempted, version) <= 0) {
    autoAttempts.delete(host.id);
    void runWithHost(host.id, () =>
      dispatch({
        severity: "info",
        title: serverT("hosts.update.notify.doneTitle"),
        detail: serverT("hosts.update.notify.doneDetail", { version }),
      }),
    ).catch(() => undefined);
  }

  const tag = agentUpdateTarget({ agentVersion: version });
  if (!tag || autoAttempts.get(host.id) === tag || !getBool("agents.auto_update")) return;
  autoAttempts.set(host.id, tag);

  void startAgentUpdate(host.id).catch((error) => {
    void runWithHost(host.id, () =>
      dispatch({
        severity: "warning",
        title: serverT("hosts.update.notify.failedTitle"),
        detail: serverT("hosts.update.notify.failedDetail", {
          tag,
          error: error instanceof Error ? error.message : String(error),
        }),
      }),
    ).catch(() => undefined);
  });
}
