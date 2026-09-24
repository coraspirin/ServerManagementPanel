import "server-only";

import net from "node:net";
import { createHmac, randomBytes } from "node:crypto";
import { serverT } from "@/lib/i18n/runtime";
import { currentHostId } from "@/lib/hosts/context";
import { isLocalHost } from "@/lib/hosts/store";

/**
 * host-helper istemcisi (T4 / M1.13).
 *
 * Panel host'ta hiçbir şey çalıştırmaz; host'ta çalışan daemon'dan **rica
 * eder**. Neyin çalıştırılabileceğine host'taki izin listesi karar verir ve o
 * dosya container'a ne mount edilir ne de env ile geçirilir — container ele
 * geçirilse bile listeyi genişletemez.
 *
 * Bu modül yalnızca sözleşmeyi uygular: imzala, gönder, cevabı çöz. Yetki
 * kararı burada DEĞİL.
 */

/**
 * Soket bir DİZİNİN içinde; doğrudan /run altında bir dosya değil.
 *
 * Docker tek dosya mount'unda yola değil inode'a bağlanır ve helper her
 * yeniden başlayışında soketi yeniden yaratır — dosyayı mount eden container
 * o andan sonra silinmiş inode'a bakıp ECONNREFUSED alır. Dizin mount'ları
 * içeriği canlı çözüyor. Eski kurulumlar HELPER_SOCKET ile eski yolu
 * kullanmaya devam edebilir.
 */
const SOCKET_PATH =
  process.env.HELPER_SOCKET ?? "/run/panel-helper/panel-helper.sock";
const TIMEOUT_MS = 130_000; // helper'ın komut zaman aşımından biraz uzun
/** Konsol eylemleri için (helper tarafında 900 sn). */
export const CONSOLE_TIMEOUT_MS = 910_000;

export type HelperAction =
  | "power.reboot"
  | "power.shutdown"
  | "power.cancel"
  | "service.status"
  | "service.restart"
  | "service.start"
  | "service.stop"
  | "service.list"
  | "compose.ps"
  | "compose.config"
  | "compose.up"
  | "compose.pull"
  | "compose.restart"
  | "compose.down"
  | "journal.read"
  | "ufw.status"
  | "ufw.status_verbose"
  | "ufw.allow"
  | "ufw.deny"
  | "ufw.delete"
  | "ufw.enable"
  | "ufw.disable"
  | "ufw.default"
  | "ufw.logging"
  | "ufw.app_list"
  | "fail2ban.status"
  | "fail2ban.jail"
  | "fail2ban.unban"
  | "cron.list"
  | "cron.list_system"
  | "shell.preset"
  | "shell.exec";

export type HelperResponse = {
  ok: boolean;
  exitCode?: number;
  stdout?: string;
  stderr?: string;
  durationMs?: number;
  error?: string;
};

export function helperConfigured(): boolean {
  if (!isLocalHost(currentHostId())) return remoteHelper?.configured() ?? false;
  return (process.env.HELPER_SECRET ?? "") !== "";
}

/**
 * Çoklu sunucu: etkin sunucu uzaksa istek o sunucudaki helper'a ajan
 * üzerinden iletilir. Ajan istemcisi kendini buraya kaydeder (import döngüsü
 * olmasın diye helper ajan modülünü doğrudan import etmiyor). Uzak sunucunun
 * HELPER_SECRET'ı ve izin listesi o sunucuda kalır; panel yalnızca ajana
 * "şu eylemi iste" der.
 */
export type RemoteHelper = {
  configured(): boolean;
  call(
    action: HelperAction,
    args: Record<string, unknown>,
    actor: { username: string; userId: number },
    timeoutMs: number,
    requestId?: string,
  ): Promise<HelperResponse>;
};

let remoteHelper: RemoteHelper | null = null;

export function registerRemoteHelper(impl: RemoteHelper): void {
  remoteHelper = impl;
}

/**
 * İmzalanan biçim helper'daki `canonical()` ile BİREBİR aynı olmalı:
 * anahtarlar sıralı, ayırıcılarda boşluk yok. Tek bir boşluk farkı imzayı
 * bozar ve hata "izin yok" gibi görünürdü — bu yüzden burada elle yazıldı.
 */
function canonical(payload: Record<string, unknown>): string {
  const sortValue = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(sortValue);
    if (value && typeof value === "object") {
      return Object.fromEntries(
        Object.keys(value as Record<string, unknown>)
          .sort()
          .map((key) => [key, sortValue((value as Record<string, unknown>)[key])]),
      );
    }
    return value;
  };

  return JSON.stringify(sortValue(payload));
}

/**
 * Soket hatasını kullanıcının yapabileceği bir şeye çevirir.
 *
 * ECONNREFUSED burada özellikle önemli: en sık görülen arıza o ve eskiden ham
 * Node mesajı olarak düşüyordu ("connect ECONNREFUSED /run/panel-helper.sock"),
 * yani kullanıcıya hiçbir şey anlatmıyordu.
 *
 * Unix soketinde ECONNREFUSED tek bir şey demek: dosya VAR ama dinleyen yok.
 * (Dosya olmasaydı ENOENT gelirdi.) İki sebebi olabilir ve ikisi de yazılıyor.
 */
function explainSocketError(error: Error): string {
  const code = (error as NodeJS.ErrnoException).code;

  if (code === "ENOENT") {
    return serverT("helper.socketMissing", { path: SOCKET_PATH });
  }

  if (code === "EACCES") {
    return serverT("helper.socketDenied");
  }

  if (code === "ECONNREFUSED") {
    // Şablon dizesi kullanılıyor: satır sonları mesajın bir parçası ve
    // kaçış dizisi yerine gerçek satır sonu yazmak okunaklı tutuyor.
    return serverT("helper.socketStale", { path: SOCKET_PATH });
  }

  return error.message;
}

export async function callHelper(
  action: HelperAction,
  args: Record<string, unknown>,
  actor: { username: string; userId: number },
  timeoutMs: number = TIMEOUT_MS,
  /**
   * İstek kimliği — normalde rastgele, ama çağıran BELİRLEYEBİLİR.
   *
   * Tek kullanıcısı /api/v1'in `Idempotency-Key` desteği: anahtardan
   * türetilmiş sabit bir id, helper'ın kendi 5 dakikalık tekrar penceresine
   * çarpar ve ikinci komut host tarafında reddedilir. Böylece garanti panelin
   * belleğine değil, protokolün en güvenilir katmanına dayanır.
   *
   * ⚠️ Aynı id ile İKİ FARKLI istek göndermek, ikincisini sessizce
   * düşürürdü — çağıran id'yi yalnızca gerçekten aynı isteğin tekrarı için
   * sabitlemeli.
   */
  requestId?: string,
): Promise<HelperResponse> {
  if (!isLocalHost(currentHostId())) {
    if (!remoteHelper) return { ok: false, error: serverT("hosts.errors.unsupported") };
    return remoteHelper.call(action, args, actor, timeoutMs, requestId);
  }
  return callLocalHelper(action, args, actor, timeoutMs, requestId);
}

/** Bu makinedeki helper soketine doğrudan istek (ajan da bunu kullanır). */
export async function callLocalHelper(
  action: HelperAction,
  args: Record<string, unknown>,
  actor: { username: string; userId: number },
  timeoutMs: number = TIMEOUT_MS,
  requestId?: string,
): Promise<HelperResponse> {
  const secret = process.env.HELPER_SECRET ?? "";
  if (secret === "") {
    return {
      ok: false,
      error: serverT("helper.noSecret"),
    };
  }

  const payload = {
    id: requestId ?? randomBytes(16).toString("hex"),
    ts: Math.floor(Date.now() / 1000),
    action,
    args,
    actor,
  };

  const message =
    JSON.stringify({
      payload,
      sig: createHmac("sha256", secret).update(canonical(payload)).digest("hex"),
    }) + "\n";

  return new Promise<HelperResponse>((resolve) => {
    const socket = net.createConnection(SOCKET_PATH);
    let buffer = "";
    let settled = false;

    const finish = (response: HelperResponse) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(response);
    };

    socket.setTimeout(timeoutMs, () =>
      finish({ ok: false, error: serverT("helper.timeout") }),
    );

    socket.on("connect", () => socket.write(message));

    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      const newline = buffer.indexOf("\n");
      if (newline === -1) return;
      try {
        finish(JSON.parse(buffer.slice(0, newline)) as HelperResponse);
      } catch {
        finish({ ok: false, error: serverT("helper.invalidResponse") });
      }
    });

    socket.on("error", (error) => {
      finish({ ok: false, error: explainSocketError(error) });
    });

    // Bağlantı yanıt gelmeden kapanırsa sessizce beklememek gerekir.
    socket.on("close", () =>
      finish({ ok: false, error: serverT("helper.closed") }),
    );
  });
}

// --- Çıktı ayrıştırıcıları -------------------------------------------------

export type SystemdUnit = {
  unit: string;
  load: string;
  active: string;
  sub: string;
  description: string;
};

/** `systemctl list-units --plain --no-legend` çıktısı. */
export function parseUnitList(stdout: string): SystemdUnit[] {
  return stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "")
    .map((line) => {
      const parts = line.split(/\s+/);
      return {
        unit: parts[0] ?? "",
        load: parts[1] ?? "",
        active: parts[2] ?? "",
        sub: parts[3] ?? "",
        description: parts.slice(4).join(" "),
      };
    })
    .filter((unit) => unit.unit.endsWith(".service"));
}

/** `systemctl show --property=...` çıktısı (anahtar=değer satırları). */
export function parseShow(stdout: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of stdout.split("\n")) {
    const index = line.indexOf("=");
    if (index === -1) continue;
    result[line.slice(0, index)] = line.slice(index + 1);
  }
  return result;
}
