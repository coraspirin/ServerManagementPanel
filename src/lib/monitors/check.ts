import "server-only";

import dns from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import { execFile } from "node:child_process";
import { isMockMode } from "@/lib/env";
import { getDockerProvider } from "@/lib/providers";
import type { Monitor } from "./types";

/**
 * M1.2 — health-check sondaları.
 *
 * `fetch` yerine `node:http`/`node:https` kullanılıyor: ev sunucularında
 * self-signed sertifika kuraldır ve `fetch` ile sertifika doğrulamasını
 * atlamak ek bağımlılık (undici dispatcher) gerektiriyor. Ayrıca bağlantı
 * zaman aşımı üzerinde tam denetim gerekiyor.
 */

export type CheckResult = {
  ok: boolean;
  latencyMs: number;
  /** Başarısızsa kullanıcıya gösterilecek kısa sebep. */
  error?: string;
};

const MAX_BODY_BYTES = 64 * 1024;

function fail(started: number, error: string): CheckResult {
  return { ok: false, latencyMs: Math.round(performance.now() - started), error };
}

function pass(started: number): CheckResult {
  return { ok: true, latencyMs: Math.round(performance.now() - started) };
}

// --- HTTP(S) ---------------------------------------------------------------

/**
 * `expected` yorumu:
 *   ""              → 400'ün altındaki her durum kodu başarılı (yönlendirme dahil)
 *   "200" / "200,204" → durum kodu listede olmalı
 *   "metin:hazır"   → gövde bu metni içermeli (durum kodu da 400'ün altında olmalı)
 */
function evaluateHttp(
  expected: string,
  status: number,
  body: string,
): { ok: boolean; error?: string } {
  const rule = expected.trim();

  if (rule.toLocaleLowerCase("tr").startsWith("metin:")) {
    const needle = rule.slice(6).trim();
    if (status >= 400) return { ok: false, error: `HTTP ${status}` };
    if (!body.includes(needle)) {
      return { ok: false, error: `yanıtta "${needle}" bulunamadı` };
    }
    return { ok: true };
  }

  if (rule.length > 0) {
    const allowed = rule.split(",").map((s) => s.trim());
    if (!allowed.includes(String(status))) {
      return { ok: false, error: `HTTP ${status} (beklenen: ${rule})` };
    }
    return { ok: true };
  }

  return status < 400 ? { ok: true } : { ok: false, error: `HTTP ${status}` };
}

function httpCheck(monitor: Monitor, timeoutMs: number): Promise<CheckResult> {
  const started = performance.now();

  let url: URL;
  try {
    url = new URL(monitor.target);
  } catch {
    return Promise.resolve(fail(started, "geçersiz adres"));
  }

  const secure = url.protocol === "https:";
  const client = secure ? https : http;
  const needsBody = monitor.expected.toLocaleLowerCase("tr").startsWith("metin:");

  return new Promise<CheckResult>((resolve) => {
    const request = client.request(
      url,
      {
        // HEAD daha ucuz olurdu ama pek çok servis (Home Assistant dahil)
        // desteklemeyip 405 döndürüyor ve monitör sahte bir hata üretiyordu.
        // Bunun yerine GET atılıp gövde gerekmediğinde yanıt hemen kapatılıyor:
        // her yerde çalışır ve gövde yine indirilmez.
        method: "GET",
        timeout: timeoutMs,
        // Sertifika doğrulaması yalnızca monitörde açıkça işaretlendiyse atlanır.
        ...(secure ? { rejectUnauthorized: !monitor.ignoreTls } : {}),
        headers: { "user-agent": "sunucu-paneli/health-check" },
      },
      (response) => {
        const status = response.statusCode ?? 0;

        if (!needsBody) {
          response.destroy(); // gövdeyi indirme, bağlantıyı kapat
          const verdict = evaluateHttp(monitor.expected, status, "");
          resolve(verdict.ok ? pass(started) : fail(started, verdict.error!));
          return;
        }

        let body = "";
        response.setEncoding("utf8");
        response.on("data", (chunk: string) => {
          if (body.length < MAX_BODY_BYTES) body += chunk;
        });
        response.on("end", () => {
          const verdict = evaluateHttp(monitor.expected, status, body);
          resolve(verdict.ok ? pass(started) : fail(started, verdict.error!));
        });
      },
    );

    request.on("timeout", () => {
      request.destroy();
      resolve(fail(started, "zaman aşımı"));
    });

    request.on("error", (error: NodeJS.ErrnoException) => {
      // Yanıtı biz kapattığımızda gelen "aborted" gerçek bir hata değil —
      // durum kodu zaten değerlendirildi ve promise çözüldü.
      if (error.code === "ECONNRESET" || error.message === "aborted") return;

      const reason =
        error.code === "ECONNREFUSED"
          ? "bağlantı reddedildi"
          : error.code === "ENOTFOUND"
            ? "adres çözümlenemedi"
            : error.code === "CERT_HAS_EXPIRED"
              ? "sertifika süresi dolmuş"
              : error.code === "DEPTH_ZERO_SELF_SIGNED_CERT" ||
                  error.code === "SELF_SIGNED_CERT_IN_CHAIN"
                ? "self-signed sertifika (monitörde TLS doğrulamasını kapatabilirsin)"
                : error.message;
      resolve(fail(started, reason));
    });

    request.end();
  });
}

// --- TCP -------------------------------------------------------------------

function tcpCheck(monitor: Monitor, timeoutMs: number): Promise<CheckResult> {
  const started = performance.now();

  const match = monitor.target.trim().match(/^(.+):(\d+)$/);
  if (!match) return Promise.resolve(fail(started, "hedef 'sunucu:port' biçiminde olmalı"));

  const [, host, portText] = match;
  const port = Number(portText);

  return new Promise<CheckResult>((resolve) => {
    const socket = net.createConnection({ host, port });
    socket.setTimeout(timeoutMs);

    const done = (result: CheckResult) => {
      socket.destroy();
      resolve(result);
    };

    socket.on("connect", () => done(pass(started)));
    socket.on("timeout", () => done(fail(started, "zaman aşımı")));
    socket.on("error", (error: NodeJS.ErrnoException) =>
      done(
        fail(
          started,
          error.code === "ECONNREFUSED"
            ? "bağlantı reddedildi"
            : error.code === "ENOTFOUND"
              ? "adres çözümlenemedi"
              : error.message,
        ),
      ),
    );
  });
}

// --- Ping ------------------------------------------------------------------

function pingCheck(monitor: Monitor, timeoutMs: number): Promise<CheckResult> {
  const started = performance.now();
  const seconds = Math.max(1, Math.round(timeoutMs / 1000));

  return new Promise<CheckResult>((resolve) => {
    // -n: DNS ters çözümleme yapma (yavaşlatır), -c 1: tek paket, -W: yanıt süresi
    execFile(
      "ping",
      ["-n", "-c", "1", "-W", String(seconds), monitor.target.trim()],
      { timeout: timeoutMs + 2000 },
      (error, stdout) => {
        if (!error) {
          // "time=12.3 ms" varsa gerçek gidiş-dönüş süresini kullan.
          const rtt = stdout.match(/time[=<]([\d.]+)\s*ms/);
          resolve({
            ok: true,
            latencyMs: rtt
              ? Math.round(Number(rtt[1]))
              : Math.round(performance.now() - started),
          });
          return;
        }

        const reason =
          (error as NodeJS.ErrnoException).code === "ENOENT"
            ? "ping komutu bulunamadı (imajda iputils-ping eksik)"
            : /unknown host|Name or service not known/i.test(stdout + error.message)
              ? "adres çözümlenemedi"
              : "yanıt yok";
        resolve(fail(started, reason));
      },
    );
  });
}

// --- DNS -------------------------------------------------------------------

async function dnsCheck(monitor: Monitor, timeoutMs: number): Promise<CheckResult> {
  const started = performance.now();

  try {
    const records = await Promise.race([
      dns.resolve4(monitor.target.trim()),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("zaman aşımı")), timeoutMs),
      ),
    ]);

    if (records.length === 0) return fail(started, "kayıt dönmedi");

    const expected = monitor.expected.trim();
    if (expected && !records.some((record) => record.includes(expected))) {
      return fail(started, `beklenen kayıt yok (${records.join(", ")})`);
    }

    return pass(started);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return fail(
      started,
      code === "ENOTFOUND" || code === "ENODATA"
        ? "alan adı çözümlenemedi"
        : error instanceof Error
          ? error.message
          : "bilinmeyen hata",
    );
  }
}

// --- Docker container ------------------------------------------------------

async function containerCheck(monitor: Monitor): Promise<CheckResult> {
  const started = performance.now();

  try {
    const state = await getDockerProvider().inspect(monitor.target.trim());
    if (!state) return fail(started, "container bulunamadı");
    if (!state.running) return fail(started, `durum: ${state.status}`);

    if (monitor.expected.trim().toLowerCase() === "healthy") {
      if (state.health === null) {
        return fail(started, "container'da Docker sağlık kontrolü tanımlı değil");
      }
      if (state.health !== "healthy") return fail(started, `sağlık: ${state.health}`);
    }

    return pass(started);
  } catch (error) {
    return fail(started, error instanceof Error ? error.message : "Docker'a erişilemedi");
  }
}

// --- MOCK_MODE -------------------------------------------------------------

/**
 * Sahte sonuç (T10). Metrik üretecinde olduğu gibi zamanın saf fonksiyonu:
 * her monitör 5 dakikalık pencerelerde deterministik olarak yukarı/aşağı olur,
 * böylece Windows'ta kesinti şeridi ve kullanılabilirlik hesabı sınanabilir.
 */
function mockCheck(monitor: Monitor): CheckResult {
  const window = Math.floor(Date.now() / 300_000);
  let hash = 2166136261;
  const input = `${monitor.id}:${window}`;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  const roll = ((hash >>> 0) % 1000) / 1000;
  const latency = 5 + ((hash >>> 8) % 180);

  return roll < 0.08
    ? { ok: false, latencyMs: latency, error: "sahte kesinti (MOCK_MODE)" }
    : { ok: true, latencyMs: latency };
}

// --- Giriş noktası ---------------------------------------------------------

export async function runCheck(monitor: Monitor, timeoutSeconds: number): Promise<CheckResult> {
  if (isMockMode()) return mockCheck(monitor);

  const timeoutMs = timeoutSeconds * 1000;
  switch (monitor.type) {
    case "http":
      return httpCheck(monitor, timeoutMs);
    case "tcp":
      return tcpCheck(monitor, timeoutMs);
    case "ping":
      return pingCheck(monitor, timeoutMs);
    case "dns":
      return dnsCheck(monitor, timeoutMs);
    case "container":
      return containerCheck(monitor);
    default:
      return { ok: false, latencyMs: 0, error: `bilinmeyen monitör tipi: ${monitor.type}` };
  }
}
