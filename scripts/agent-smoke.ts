/**
 * Ajan uyum sınaması — merkezin KENDİ protokol modülüyle (imza, codec, kayıt
 * kanıtı: src/lib/agent/protocol.ts) çalışan bir ajana gerçek TLS istekleri
 * atar ve yanıt biçimlerini merkezin beklediği tiplerle karşılaştırır. Native
 * (Go) ajan ile Node ajanın aynı sözleşmeyi konuştuğunu uçtan uca gösterir.
 *
 *   node scripts/agent-smoke.ts https://127.0.0.1:7443 <AGENT_TOKEN>
 *
 * Yalnız okuma op'ları çağrılır; ajanda hiçbir şey değiştirmez.
 */
import { randomBytes } from "node:crypto";
import tls from "node:tls";
import http from "node:http";

import {
  AGENT_HEADERS,
  decodeValue,
  encodeValue,
  normalizeFingerprint,
  signRequest,
  verifyEnrollProof,
  type AgentHello,
  type RpcResponse,
} from "../src/lib/agent/protocol.ts";

const [url, secret] = process.argv.slice(2);
if (!url || !secret) {
  console.error("kullanım: node scripts/agent-smoke.ts https://adres:7443 <AGENT_TOKEN>"); // i18n-ignore — geliştirici çıktısı
  process.exit(2);
}
const target = new URL(url);

type Exchange = { status: number; text: string; fingerprint: string };

function exchange(path: string, body: string): Promise<Exchange> {
  return new Promise((resolve, reject) => {
    // Merkez de CA'ya değil, kayıtta sabitlediği parmak izine güvenir
    // (client.ts agentExchange); burada görülen parmak izi kanıtla sınanıyor.
    const socket = tls.connect({ host: target.hostname, port: Number(target.port || 7443), rejectUnauthorized: false });
    socket.once("error", reject);
    socket.once("secureConnect", () => {
      const fingerprint = socket.getPeerCertificate().fingerprint256 ?? "";
      const ts = String(Math.floor(Date.now() / 1000));
      const nonce = randomBytes(16).toString("hex");
      const request = http.request({
        createConnection: () => socket,
        method: "POST",
        path,
        headers: {
          host: target.host,
          "content-type": "application/json",
          "content-length": Buffer.byteLength(body),
          [AGENT_HEADERS.ts]: ts,
          [AGENT_HEADERS.nonce]: nonce,
          [AGENT_HEADERS.sig]: signRequest(secret, { method: "POST", path, ts, nonce, body }),
        },
      });
      request.once("error", reject);
      request.once("response", (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () => {
          socket.destroy();
          resolve({ status: response.statusCode ?? 0, text: Buffer.concat(chunks).toString("utf8"), fingerprint });
        });
      });
      request.end(body);
    });
  });
}

const rpc = async (op: string, args: unknown[] = [], settings: Record<string, unknown> = {}) => {
  const reply = await exchange("/api/agent/rpc", encodeValue({ op, args, settings }));
  return { status: reply.status, body: decodeValue(reply.text) as RpcResponse };
};

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (!ok) failed += 1;
  console.log(`${ok ? "OK  " : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
}

function hasKeys(value: unknown, keys: string[]): boolean {
  return typeof value === "object" && value !== null && keys.every((key) => key in value);
}

// 1. Kayıt: imzalı nonce → parmak izi + kanıt; TLS'te görülenle aynı olmalı.
const nonce = randomBytes(16).toString("hex");
const enroll = await exchange("/api/agent/enroll", JSON.stringify({ nonce }));
const enrolled = JSON.parse(enroll.text) as { fingerprint: string; proof: string; hello: AgentHello };
check(
  "enroll: kanıt + parmak izi sabitlemesi",
  enroll.status === 200 &&
    normalizeFingerprint(enrolled.fingerprint) === normalizeFingerprint(enroll.fingerprint) &&
    verifyEnrollProof(secret, nonce, enrolled.fingerprint, enrolled.proof),
  enroll.fingerprint,
);

// 2. hello: merkezin AgentHello tipi.
const hello = await rpc("agent.hello");
const value = hello.body.ok ? (hello.body.value as AgentHello) : null;
check(
  "agent.hello",
  value !== null &&
    value.protocol === 3 &&
    hasKeys(value, ["version", "hostname", "osName", "time"]) &&
    hasKeys(value.capabilities, ["docker", "helper", "hostRoot", "reports", "dockerApi", "dockerRpc"]),
  value ? `v${value.version} native=${value.capabilities.native} ops=${value.capabilities.ops?.join(",")}` : JSON.stringify(hello.body),
);
if (value) {
  // Protokol 60 sn'ye izin verir (CLOCK_SKEW_SECONDS); 5 sn'yi aşan fark
  // uyarı olarak yazılır — saat eşitlemesi bozulmaya başlamış demektir.
  const skew = Math.abs(value.time - Math.floor(Date.now() / 1000));
  check("saat farkı < 60 sn", skew < 60, skew > 5 ? `${skew} sn — UYARI: saat eşitlemesini kontrol et` : `${skew} sn`);
}

// 3. system.info: SystemInfo.
const info = await rpc("system.info");
check(
  "system.info",
  info.body.ok && hasKeys(info.body.value, ["hostname", "platform", "release", "osName", "arch", "cpuModel", "cpuCount", "totalMemBytes", "uptimeSeconds"]),
  info.body.ok ? JSON.stringify(info.body.value) : "",
);

// 4. metrics.sample: ilk çağrıda oran yok, ikincide var (aynı süreç durumu).
const first = await rpc("metrics.sample", [], { "monitoring.disks": "", "monitoring.net_interfaces": "" });
await new Promise((resolve) => setTimeout(resolve, 1500));
const second = await rpc("metrics.sample", [], { "monitoring.disks": "", "monitoring.net_interfaces": "" });
const samples = (second.body.ok ? second.body.value : []) as { metric: string; label?: string; value: number }[];
check(
  "metrics.sample",
  first.body.ok && second.body.ok && samples.every((s) => typeof s.metric === "string" && typeof s.value === "number"),
  `${samples.length} örnek: ${[...new Set(samples.map((s) => s.metric))].join(", ")}`,
);

// 5. hardware.report: HardwareReport (dizi alanları null değil).
const hardware = await rpc("hardware.report", [], { "general.language": "tr" });
const report = hardware.body.ok ? (hardware.body.value as Record<string, unknown>) : null;
check(
  "hardware.report",
  report !== null && ["temperatures", "disks", "pools", "notes"].every((key) => Array.isArray(report[key])),
  report ? `${(report.temperatures as unknown[]).length} sensör, notlar: ${(report.notes as string[]).join(" | ").slice(0, 160)}` : "",
);

// 6. Bilinmeyen op: 404 + RPC gövdesi (merkez bunu "desteklenmiyor"a çevirir).
const unknown = await rpc("docker.list");
check(
  "bilinmeyen op → 404 unknown-op",
  unknown.status === 404 && !unknown.body.ok && unknown.body.error.message === "unknown-op:docker.list",
);

// 7. Yanlış sır → 401.
const forged = await new Promise<number>((resolve, reject) => {
  const socket = tls.connect({ host: target.hostname, port: Number(target.port || 7443), rejectUnauthorized: false });
  socket.once("error", reject);
  socket.once("secureConnect", () => {
    const body = encodeValue({ op: "agent.hello", args: [], settings: {} });
    const ts = String(Math.floor(Date.now() / 1000));
    const nonce2 = randomBytes(16).toString("hex");
    const request = http.request({
      createConnection: () => socket,
      method: "POST",
      path: "/api/agent/rpc",
      headers: {
        "content-length": Buffer.byteLength(body),
        [AGENT_HEADERS.ts]: ts,
        [AGENT_HEADERS.nonce]: nonce2,
        [AGENT_HEADERS.sig]: signRequest(`${secret}-yanlis`, { method: "POST", path: "/api/agent/rpc", ts, nonce: nonce2, body }),
      },
    });
    request.once("response", (response) => {
      response.resume();
      socket.destroy();
      resolve(response.statusCode ?? 0);
    });
    request.end(body);
  });
});
check("yanlış sır → 401", forged === 401);

console.log(`\n${failed === 0 ? "tümü geçti" : `${failed} başarısız`}`); // i18n-ignore — geliştirici çıktısı
process.exit(failed === 0 ? 0 : 1);
