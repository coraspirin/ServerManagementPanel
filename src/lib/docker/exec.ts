import http from "node:http";
import type { Duplex } from "node:stream";
import { randomBytes } from "node:crypto";
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
 */

const SOCKET_PATH = process.env.DOCKER_SOCKET ?? "/var/run/docker.sock";

/** Çıktı, tüketici bağlanana kadar burada birikir. */
export type Session = {
  id: string;
  execId: string;
  containerId: string;
  containerName: string;
  username: string;
  socket: Duplex;
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
      if (now - session.lastSeen > timeout) closeSession(session.id, "boşta kaldı");
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
    req.on("timeout", () => req.destroy(new Error("Docker soketi zaman aşımına uğradı")));
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

export async function startSession(options: StartExecOptions): Promise<Session> {
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
        ? "container bulunamadı"
        : created.status === 409
          ? "container çalışmıyor"
          : `exec oluşturulamadı (${created.status}): ${created.raw.slice(0, 160)}`,
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

  const session: Session = {
    id: randomBytes(16).toString("base64url"),
    execId,
    containerId: options.containerId,
    containerName: options.containerName,
    username: options.username,
    socket,
    pending: [],
    wake: null,
    closed: false,
    exitCode: null,
    lastSeen: Date.now(),
    startedAt: Date.now(),
  };

  socket.on("data", (chunk: Buffer) => {
    session.pending.push(chunk);
    session.wake?.();
  });

  const finish = () => {
    if (session.closed) return;
    session.closed = true;
    session.wake?.();
    // Kayıttan hemen silinmiyor: SSE tarafı kabuk kapandıktan sonra bağlanmış
    // olabilir ve çıkış kodunu bildirmeden kapanmamalı. Kısa bir tolerans
    // penceresinden sonra silinince, kapanmış bir oturuma yapılan istekler
    // 404 alır — "kapandı ama hâlâ 200 dönüyor" hali kafa karıştırıcıydı.
    setTimeout(() => sessions.delete(session.id), 5_000).unref?.();
  };
  socket.on("end", finish);
  socket.on("close", finish);
  socket.on("error", finish);

  sessions.set(session.id, session);
  startReaper();

  await resizeSession(session.id, options.cols, options.rows);
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
  session.socket.write(data);
}

export async function resizeSession(id: string, cols: number, rows: number): Promise<void> {
  const session = sessions.get(id);
  if (!session || session.closed) return;
  await dockerJson(`/exec/${session.execId}/resize?h=${rows}&w=${cols}`, "POST");
}

export async function exitCodeOf(session: Session): Promise<number | null> {
  if (session.exitCode !== null) return session.exitCode;
  const info = await dockerJson<{ Running: boolean; ExitCode: number | null }>(
    `/exec/${session.execId}/json`,
    "GET",
  );
  if (info.data && info.data.Running === false) session.exitCode = info.data.ExitCode ?? 0;
  return session.exitCode;
}

export function closeSession(id: string, reason?: string): string | null {
  const session = sessions.get(id);
  if (!session) return null;

  session.closed = true;
  session.socket.destroy();
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
