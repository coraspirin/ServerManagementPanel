import { serverT } from "@/lib/i18n/runtime";
import http from "node:http";
import type { Duplex } from "node:stream";
import { randomBytes } from "node:crypto";
import { agentCall, agentStream } from "@/lib/agent/client";
import { currentHostId, LOCAL_HOST_ID } from "@/lib/hosts/context";
import { getHost } from "@/lib/hosts/store";
import type { Host } from "@/lib/hosts/types";
import { getNumber, getString } from "@/lib/settings";

/**
 * Container içinde kabuk oturumu (M1.9).
 *
 * ## Neden WebSocket değil
 *
 * Next 16 Route Handler'ları WebSocket yükseltmesini desteklemiyor (dokümanda
 * açıkça yazıyor: "WebSockets won't work because the connection closes on
 * timeout, or after the response is generated"). Seçenekler özel bir HTTP
 * sunucusu yazmak ya da akışı ikiye bölmekti. Özel sunucu, standalone çıktının
 * dosya izlemesini ve Dockerfile'ın giriş noktasını değiştirmek demekti —
 * terminal için tüm dağıtım hattını riske atmaya değmez.
 *
 * Bu yüzden akış ikiye bölündü: **çıktı SSE**, **giriş POST**. Yerel ağda
 * tuş başına bir POST'un gecikmesi birkaç milisaniye; kullanıcı farkı
 * hissetmiyor.
 *
 * ## Neden bellekte durum
 *
 * Docker'ın hijack edilmiş soketi iki yönlü ve tek: giriş ve çıkış uçları
 * AYNI sokete bağlı. İki ayrı HTTP isteğinin aynı soketi paylaşması için
 * soketin istekler arasında yaşaması gerekiyor. Panel tek bir uzun ömürlü
 * Node süreci olarak çalıştığı (job runner da buna dayanıyor) için modül
 * düzeyinde bir Map yeterli. Sunucusuz bir ortama taşınırsa bu tasarım
 * çalışmaz — orada gerçek bir WebSocket ya da ayrı bir terminal servisi gerekir.
 *
 * ## Uzak sunucu (çoklu sunucu)
 *
 * Oturum yine BURADA, merkezde ve kullanıcıya bağlı; değişen yalnızca altındaki
 * G/Ç ucu (`ExecBackend`). Uzak sunucuda exec ajanda açılır: çıktı ajandan
 * akış olarak gelir, giriş/boyut/kapatma imzalı çağrılarla gider. Ajan kendi
 * tarafında aynı modülü yerel oturumla kullanır.
 */

const SOCKET_PATH = process.env.DOCKER_SOCKET ?? "/var/run/docker.sock";

/** Ajanda açılan oturumların sahibi: merkezdeki kullanıcı merkezde denetleniyor. */
export const AGENT_EXEC_USER = "agent";

/** Oturumun G/Ç ucu: yerelde Docker'ın soketi, uzak sunucuda ajan. */
type ExecBackend = {
  write(data: string): void;
  resize(cols: number, rows: number): Promise<void>;
  /** Kabuk bittiyse çıkış kodu, sürüyorsa null. */
  exitCode(): Promise<number | null>;
  destroy(): void;
};

/** Çıktı, tüketici bağlanana kadar burada birikir. */
export type Session = {
  id: string;
  hostId: number;
  containerId: string;
  containerName: string;
  username: string;
  backend: ExecBackend;
  /** SSE tarafına aktarılmayı bekleyen çıktı. */
  pending: Buffer[];
  /** Yeni veri geldiğinde uyandırılacak tüketici. */
  wake: (() => void) | null;
  closed: boolean;
  exitCode: number | null;
  lastSeen: number;
  startedAt: number;
};

const sessions = new Map<string, Session>();

/** Terkedilmiş oturumlar container içinde kabuk bırakmasın (süre ayardan). */
let reaper: NodeJS.Timeout | null = null;

function startReaper() {
  if (reaper) return;
  reaper = setInterval(() => {
    const now = Date.now();
    const timeout = getNumber("docker.exec_idle_minutes") * 60_000;
    for (const session of sessions.values()) {
      if (now - session.lastSeen > timeout) closeSession(session.id, serverT("execLib.idle"));
    }
    if (sessions.size === 0 && reaper) {
      clearInterval(reaper);
      reaper = null;
    }
  }, 30_000);
  // Zamanlayıcı süreci ayakta tutmasın.
  reaper.unref?.();
}

function dockerJson<T>(
  path: string,
  method: "GET" | "POST",
  body?: unknown,
): Promise<{ status: number; data: T | null; raw: string }> {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : JSON.stringify(body);
    const req = http.request(
      {
        socketPath: SOCKET_PATH,
        path,
        method,
        timeout: 10_000,
        headers: payload
          ? { "content-type": "application/json", "content-length": Buffer.byteLength(payload) }
          : undefined,
      },
      (res) => {
        let text = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => (text += chunk));
        res.on("end", () => {
          let data: T | null = null;
          try {
            data = JSON.parse(text) as T;
          } catch {
            // Gövde boş ya da JSON değil.
          }
          resolve({ status: res.statusCode ?? 0, data, raw: text });
        });
      },
    );
    req.on("timeout", () => req.destroy(new Error(serverT("execLib.socketTimeout"))));
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

export type StartExecOptions = {
  containerId: string;
  containerName: string;
  username: string;
  cols: number;
  rows: number;
  /**
   * Bu oturum için kabuk (M3.34); verilmezse `docker.exec_shell` ayarı.
   *
   * Ayar TÜM container'lar için tek değer ve bu bir sorundu: bash'i olan bir
   * container'da bash, olmayanda sh istemenin tek yolu ayarı sürekli
   * değiştirmekti. Seçim artık oturum başına; ayar varsayılan olmayı
   * sürdürüyor.
   */
  shell?: string;
  /**
   * Kabuğu çalıştıracak kullanıcı (`docker exec -u`); boşsa imajın varsayılanı.
   *
   * Root olarak açılan bir kabukta uygulamanın kendi kullanıcısıyla test
   * yapmak mümkün değil — dosya izinleri sorununu ararken tam olarak gereken
   * şey bu.
   */
  user?: string;
};

/**
 * Çalıştırılacak kabuk komutu.
 *
 * "auto" seçeneği tek bir `sh -c` içinde bash'i arıyor: Alpine tabanlı
 * image'larda bash yoktur ve sabit `/bin/bash` yazmak "executable file not
 * found" ile karşılanırdı. Kullanıcının her container için ayrı ayar
 * tutmasını beklemek yerine tespit container'ın içinde yapılıyor.
 */
function shellCommand(secim?: string): string[] {
  const shell = (secim ?? "").trim() || getString("docker.exec_shell");
  if (shell !== "auto") return [shell];
  return [
    "/bin/sh",
    "-c",
    "if command -v bash >/dev/null 2>&1; then exec bash; else exec sh; fi",
  ];
}

/** Seçili sunucu ajanla yönetiliyorsa o sunucu; yerel ise null. */
function remoteAgentHost(): Host | null {
  const hostId = currentHostId();
  if (hostId === LOCAL_HOST_ID) return null;
  const host = getHost(hostId);
  return host && !host.isLocal && host.agentType === "agent" ? host : null;
}

function newSession(options: StartExecOptions, hostId: number, backend: ExecBackend): Session {
  return {
    id: randomBytes(16).toString("base64url"),
    hostId,
    containerId: options.containerId,
    containerName: options.containerName,
    username: options.username,
    backend,
    pending: [],
    wake: null,
    closed: false,
    exitCode: null,
    lastSeen: Date.now(),
    startedAt: Date.now(),
  };
}

function pushOutput(session: Session, chunk: Buffer) {
  session.pending.push(chunk);
  session.wake?.();
}

function finishSession(session: Session) {
  if (session.closed) return;
  session.closed = true;
  session.wake?.();
  // Kayıttan hemen silinmiyor: SSE tarafı kabuk kapandıktan sonra bağlanmış
  // olabilir ve çıkış kodunu bildirmeden kapanmamalı. Kısa bir tolerans
  // penceresinden sonra silinince, kapanmış bir oturuma yapılan istekler
  // 404 alır — "kapandı ama hâlâ 200 dönüyor" hali kafa karıştırıcıydı.
  setTimeout(() => sessions.delete(session.id), 5_000).unref?.();
}

export async function startSession(options: StartExecOptions): Promise<Session> {
  const host = remoteAgentHost();
  const session = host ? await startRemote(host, options) : await startLocal(options);
  sessions.set(session.id, session);
  startReaper();
  return session;
}

type ExecFrame = { out?: string; exit?: number | null };

/**
 * Uzak oturum. Giriş sırası korunmalı: her tuş ayrı bir çağrı olsaydı ayrı
 * bağlantılar ajana karışık sırayla varabilirdi. Bu yüzden tek kuyruk —
 * çağrı sürerken gelen girişler birikip bir sonrakinde birlikte gider.
 */
async function startRemote(host: Host, options: StartExecOptions): Promise<Session> {
  const started = await agentCall<{ id: string }>(host, "exec.start", [
    {
      containerId: options.containerId,
      containerName: options.containerName,
      cols: options.cols,
      rows: options.rows,
      shell: options.shell ?? "",
      user: options.user ?? "",
    },
  ]);
  const remoteId = started.id;
  const abort = new AbortController();
  let remoteExit: number | null = null;
  let buffered = "";
  let sending = false;

  const flush = async () => {
    if (sending) return;
    sending = true;
    while (buffered) {
      const data = buffered;
      buffered = "";
      try {
        await agentCall(host, "exec.input", [remoteId, data]);
      } catch {
        finishSession(session);
        buffered = "";
      }
    }
    sending = false;
  };

  const session = newSession(options, host.id, {
    write: (data) => {
      buffered += data;
      void flush();
    },
    resize: async (cols, rows) => {
      await agentCall(host, "exec.resize", [remoteId, cols, rows]);
    },
    exitCode: async () => remoteExit,
    destroy: () => {
      abort.abort();
      void agentCall(host, "exec.close", [remoteId]).catch(() => {});
    },
  });

  void (async () => {
    try {
      for await (const frame of agentStream<ExecFrame>(host, "exec.output", [remoteId], abort.signal)) {
        if (typeof frame.out === "string") pushOutput(session, Buffer.from(frame.out, "utf8"));
        if (frame.exit !== undefined) remoteExit = frame.exit;
      }
    } catch {
      // Ajan bağlantısı koptu: oturum kapanmış sayılır.
    }
    finishSession(session);
  })();

  return session;
}

async function startLocal(options: StartExecOptions): Promise<Session> {
  const created = await dockerJson<{ Id: string }>(
    `/containers/${encodeURIComponent(options.containerId)}/exec`,
    "POST",
    {
      AttachStdin: true,
      AttachStdout: true,
      AttachStderr: true,
      Tty: true,
      Cmd: shellCommand(options.shell),
      // Boş `User` = imajın varsayılanı; Docker'ın kendi davranışı bu.
      ...(options.user ? { User: options.user } : {}),
    },
  );

  if (created.status !== 201 || !created.data?.Id) {
    throw new Error(
      created.status === 404
        ? serverT("dockerUpdate.notFound")
        : created.status === 409
          ? serverT("execLib.notRunning")
          : serverT("execLib.createFailed", {
              status: created.status,
              raw: created.raw.slice(0, 160),
            }),
    );
  }

  const execId = created.data.Id;

  // `/exec/{id}/start` hijack edilmiş bir sokete dönüşür: yanıt gövdesi yerine
  // ham iki yönlü akış. `node:http`'nin `upgrade` olayı bunu veriyor.
  const socket = await new Promise<Duplex>((resolve, reject) => {
    const payload = JSON.stringify({ Detach: false, Tty: true });
    const req = http.request({
      socketPath: SOCKET_PATH,
      path: `/exec/${execId}/start`,
      method: "POST",
      headers: {
        "content-type": "application/json",
        "content-length": Buffer.byteLength(payload),
        Connection: "Upgrade",
        Upgrade: "tcp",
      },
    });

    req.on("upgrade", (_res, upgraded) => resolve(upgraded));
    // Docker bazı sürümlerde yükseltme yapmadan doğrudan akışa geçer.
    req.on("response", (res) => resolve(res as unknown as Duplex));
    req.on("error", reject);
    req.write(payload);
    req.end();
  });

  const session = newSession(options, LOCAL_HOST_ID, {
    write: (data) => socket.write(data),
    resize: async (cols, rows) => {
      await dockerJson(`/exec/${execId}/resize?h=${rows}&w=${cols}`, "POST");
    },
    exitCode: async () => {
      const info = await dockerJson<{ Running: boolean; ExitCode: number | null }>(
        `/exec/${execId}/json`,
        "GET",
      );
      return info.data && info.data.Running === false ? (info.data.ExitCode ?? 0) : null;
    },
    destroy: () => socket.destroy(),
  });

  socket.on("data", (chunk: Buffer) => pushOutput(session, chunk));
  const finish = () => finishSession(session);
  socket.on("end", finish);
  socket.on("close", finish);
  socket.on("error", finish);

  await session.backend.resize(options.cols, options.rows);
  return session;
}

export function getSession(id: string, username: string): Session | null {
  const session = sessions.get(id);
  // Oturum sahibinden başkası bağlanamaz: id tahmin edilemez olsa bile,
  // yetkilendirmeyi "bilinmesi zor" bir değere dayandırmak yetmez.
  if (!session || session.username !== username) return null;
  session.lastSeen = Date.now();
  return session;
}

export function writeInput(session: Session, data: string): void {
  if (session.closed) return;
  session.backend.write(data);
}

export async function resizeSession(id: string, cols: number, rows: number): Promise<void> {
  const session = sessions.get(id);
  if (!session || session.closed) return;
  await session.backend.resize(cols, rows);
}

export async function exitCodeOf(session: Session): Promise<number | null> {
  if (session.exitCode !== null) return session.exitCode;
  session.exitCode = await session.backend.exitCode();
  return session.exitCode;
}

export function closeSession(id: string, reason?: string): string | null {
  const session = sessions.get(id);
  if (!session) return null;

  session.closed = true;
  session.backend.destroy();
  session.wake?.();
  sessions.delete(id);
  return reason ?? null;
}

/**
 * Çıktıyı olay olarak üretir.
 *
 * Yeni veri yokken meşgul döngüye girmiyor: `wake` ile uyandırılan bir söz
 * bekleniyor. Aksi halde boşta duran her terminal bir CPU çekirdeğini yerdi.
 */
export async function* readOutput(
  session: Session,
  signal: AbortSignal,
): AsyncGenerator<string> {
  while (!signal.aborted) {
    if (session.pending.length > 0) {
      const chunk = Buffer.concat(session.pending);
      session.pending = [];
      session.lastSeen = Date.now();
      yield chunk.toString("utf8");
      continue;
    }

    if (session.closed) return;

    await new Promise<void>((resolve) => {
      session.wake = resolve;
      // İptal edilirse beklemeden çık.
      signal.addEventListener("abort", () => resolve(), { once: true });
    });
    session.wake = null;
  }
}

/** Açık oturumlar — güvenlik ekranında (M3.8) görünmesi için. */
export function activeSessions(): {
  id: string;
  container: string;
  username: string;
  startedAt: number;
}[] {
  return [...sessions.values()].map((session) => ({
    id: session.id,
    container: session.containerName,
    username: session.username,
    startedAt: session.startedAt,
  }));
}

/** Ajan tarafı: merkezin açtırdığı oturum; yoksa merkez 404 benzeri hata görür. */
export function agentSession(id: string): Session {
  const session = getSession(id, AGENT_EXEC_USER);
  if (!session) throw new Error(serverT("api.notFound.session"));
  return session;
}

/** Ajan tarafı: oturum çıktısı akış olarak; kabuk bitince son çerçeve çıkış kodu. */
export async function* streamAgentSession(id: string, signal: AbortSignal): AsyncGenerator<ExecFrame> {
  const session = agentSession(id);
  for await (const chunk of readOutput(session, signal)) yield { out: chunk };
  if (!signal.aborted) yield { exit: await exitCodeOf(session) };
}
