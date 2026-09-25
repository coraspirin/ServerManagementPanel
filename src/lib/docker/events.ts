import "server-only";

import http from "node:http";

import { agentStream } from "@/lib/agent/client";
import { announce } from "@/lib/alerts/announce";
import { recordEvent } from "@/lib/alerts/store";
import { isMockMode } from "@/lib/env";
import { runWithHost } from "@/lib/hosts/context";
import { getHost } from "@/lib/hosts/store";
import type { Host } from "@/lib/hosts/types";
import { getBool } from "@/lib/settings";
import { classify, type DockerEventRaw } from "./eventmap";

/**
 * Docker olay akışına abonelik (M3.32).
 *
 * ## Neden bir "iş" değil
 *
 * [jobs/definitions.ts](../jobs/definitions.ts) altındaki her şey periyodik:
 * çalışır, biter, bir sonraki tetiklemeyi bekler. Olay akışı ise UZUN ÖMÜRLÜ
 * bir bağlantı — Docker olayları oluştukça yazıyor. Bunu bir işe sığdırmak,
 * her turda bağlanıp `--since` ile geçmişi taramak demek olurdu: hem
 * gecikmeli, hem de iki tur arasındaki olayları kaçırma riski taşıyan bir
 * çözüm.
 *
 * Bu yüzden `instrumentation.ts` üzerinden süreç başına TEK dinleyici açılıyor.
 *
 * ## Kopunca ne oluyor
 *
 * Docker daemon yeniden başlarsa akış kapanıyor. Yeniden bağlanma artan
 * gecikmeyle deneniyor ve `since` son görülen olayın zamanına ayarlanıyor —
 * daemon'ın ayakta olmadığı süre boyunca biriken olaylar bağlantı kurulunca
 * geriye dönük okunuyor, yani kopma bir boşluk bırakmıyor.
 *
 * Bağlantı hiç kurulamıyorsa panel çalışmaya DEVAM EDİYOR: olay akışı bir
 * bonus, panelin çalışma koşulu değil.
 *
 * ## Uzak sunucular (çoklu sunucu)
 *
 * Her çevrimiçi ajan için merkezde ayrı bir izleyici: ajan ham olayları akıtır
 * (`docker.events`), sınıflandırma ve bildirim merkezde, o sunucunun
 * bağlamında yapılır — olay kaydı doğru `host_id` ile yazılır, başlık sunucu
 * adını taşır. İzleyicileri `hosts.heartbeat` işi eşitliyor.
 */

const SOCKET_PATH = process.env.DOCKER_SOCKET ?? "/var/run/docker.sock";

/** İlk yeniden bağlanma gecikmesi; her başarısızlıkta ikiye katlanıyor. */
const ILK_GECIKME_MS = 2_000;
const AZAMI_GECIKME_MS = 60_000;

let started = false;
let gecikme = ILK_GECIKME_MS;
/** Son işlenen olayın zamanı — yeniden bağlanmada boşluk bırakmamak için. */
let sonZaman = 0;

/**
 * Olayı kaydeder, gerekiyorsa bildirir.
 *
 * `announce()` hem kaydediyor hem bildiriyor; bildirim gerekmeyen olaylarda
 * doğrudan `recordEvent()` kullanılıyor. İkisini ayırmak, sıradan bir
 * `start` olayının bildirim hattını (Telegram, ntfy, MQTT) hiç meşgul
 * etmemesi demek — sunucuda günde yüzlerce böyle olay oluyor.
 */
async function handle(raw: DockerEventRaw, remote?: { host: Host; state: { lastTs: number } }): Promise<void> {
  const classified = classify(raw);
  if (!classified) return;

  // Uzak sunucuda başlık sunucu adını taşır ve bastırma anahtarı sunucuya
  // özeldir: iki sunucudaki aynı adlı container tek alarmda birleşmesin.
  const event = remote
    ? {
        ...classified,
        title: `${remote.host.name} · ${classified.title}`,
        alertKey: `h${remote.host.id}:${classified.alertKey}`,
      }
    : classified;

  if (remote) remote.state.lastTs = Math.max(remote.state.lastTs, event.ts);
  else sonZaman = Math.max(sonZaman, event.ts);

  if (!event.notify) {
    recordEvent({
      ts: event.ts,
      alertKey: event.alertKey,
      source: "docker",
      severity: event.severity,
      title: event.title,
      detail: event.detail,
      notifiedChannels: [],
      // Bildirilmemesi bir baskılama değil, olayın niteliği. Sebep alanına
      // yazmak "neden haber gelmedi" sorusuna doğru cevabı veriyor.
      suppressedReason: "rutin",
    });
    return;
  }

  await announce({
    alertKey: event.alertKey,
    source: "docker",
    severity: event.severity,
    title: event.title,
    detail: event.detail,
  }).catch((error) => {
    console.error("[docker-events] bildirim gönderilemedi:", error);
  });
}

function connect(): void {
  const since = sonZaman > 0 ? `&since=${sonZaman}` : "";
  const path =
    "/events?filters=" +
    encodeURIComponent(JSON.stringify({ type: ["container"] })) +
    since;

  const req = http.request(
    {
      socketPath: SOCKET_PATH,
      path,
      method: "GET",
      // Zaman aşımı YOK: akış tanımı gereği sessiz kalabilir. `timeout`
      // vermek, olay olmayan her dakikada bağlantıyı koparırdı.
    },
    (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        console.error(`[docker-events] beklenmeyen yanıt: HTTP ${res.statusCode}`);
        yenidenBagla();
        return;
      }

      console.log("[docker-events] Docker olay akışına bağlanıldı");
      gecikme = ILK_GECIKME_MS;

      /*
        Akış NDJSON: her satır bir olay. Ama TCP parçaları satır sınırında
        gelmiyor — bir olay iki parçaya bölünebiliyor ya da bir parçada üç
        olay birden gelebiliyor. Tampon bu yüzden şart; parçayı doğrudan
        `JSON.parse`a vermek yarım satırlarda çöker.
      */
      let buffer = "";
      res.setEncoding("utf8");

      res.on("data", (chunk: string) => {
        buffer += chunk;

        let index = buffer.indexOf("\n");
        while (index !== -1) {
          const line = buffer.slice(0, index).trim();
          buffer = buffer.slice(index + 1);
          index = buffer.indexOf("\n");

          if (!line) continue;
          try {
            void handle(JSON.parse(line) as DockerEventRaw);
          } catch {
            // Bozuk bir satır akışı bitirmemeli.
          }
        }

        // Tampon aşırı büyürse (bozuk akış) sıfırlanıyor: sonsuza kadar
        // büyüyen bir dize belleği tüketir.
        if (buffer.length > 1_000_000) buffer = "";
      });

      res.on("end", () => {
        console.warn("[docker-events] akış kapandı");
        yenidenBagla();
      });

      res.on("error", (error) => {
        console.error("[docker-events] akış hatası:", error.message);
        yenidenBagla();
      });
    },
  );

  req.on("error", (error) => {
    console.error(`[docker-events] bağlanılamadı: ${error.message}`);
    yenidenBagla();
  });

  req.end();
}

let bekleyen: NodeJS.Timeout | null = null;

function yenidenBagla(): void {
  // Aynı kopmadan hem `end` hem `error` gelebiliyor; iki zamanlayıcı kurmak
  // bağlantı sayısını her turda ikiye katlardı.
  if (bekleyen) return;

  bekleyen = setTimeout(() => {
    bekleyen = null;
    connect();
  }, gecikme);
  bekleyen.unref?.();

  gecikme = Math.min(gecikme * 2, AZAMI_GECIKME_MS);
}

/**
 * Akışı başlatır. Süreç başına bir kez çağrılabilir; ikinci çağrı yok sayılır.
 *
 * MOCK_MODE'da hiç bağlanmıyor: sahte bir Docker soketi yok ve saniyede bir
 * "bağlanılamadı" basmak geliştirme günlüğünü kullanılmaz hale getirirdi.
 */
export function startDockerEvents(): void {
  if (started) return;
  if (isMockMode()) return;
  if (!getBool("docker.events_enabled")) {
    console.log("[docker-events] ayardan kapalı");
    return;
  }

  started = true;
  connect();
}

// --- Uzak sunucular --------------------------------------------------------

/**
 * Ham container olayları akış olarak (ajan tarafı: `docker.events`).
 *
 * MOCK_MODE'da soket yoksa hiçbir şey üretmeden iptali bekler; `DOCKER_SOCKET`
 * açıkça verildiyse (deneme için sahte bir daemon) ona bağlanır.
 */
export async function* dockerEventStream(since: number, signal: AbortSignal): AsyncGenerator<DockerEventRaw> {
  if (isMockMode() && !process.env.DOCKER_SOCKET) {
    await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }));
    return;
  }

  const path =
    "/events?filters=" +
    encodeURIComponent(JSON.stringify({ type: ["container"] })) +
    (since > 0 ? `&since=${Math.floor(since)}` : "");

  const response = await new Promise<http.IncomingMessage>((resolve, reject) => {
    const req = http.request({ socketPath: SOCKET_PATH, path, method: "GET" }, resolve);
    req.on("error", reject);
    signal.addEventListener("abort", () => req.destroy(), { once: true });
    req.end();
  });

  if (response.statusCode !== 200) {
    response.resume();
    throw new Error(`HTTP ${response.statusCode}`);
  }

  let buffer = "";
  response.setEncoding("utf8");
  try {
    for await (const chunk of response) {
      buffer += chunk as string;
      let index: number;
      while ((index = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, index).trim();
        buffer = buffer.slice(index + 1);
        if (!line) continue;
        try {
          yield JSON.parse(line) as DockerEventRaw;
        } catch {
          // Bozuk satır: akışın geri kalanını düşürmeye değmez.
        }
      }
      if (buffer.length > 1_000_000) buffer = "";
    }
  } finally {
    response.destroy();
  }
}

const remoteWatchers = new Map<number, AbortController>();

function watchable(host: Host | null): host is Host {
  return (
    host !== null &&
    host.agentType === "agent" &&
    host.enabled &&
    host.status === "online" &&
    host.certFingerprint !== null
  );
}

/** Çevrimiçi her ajan için bir izleyici; gerisi kapatılır. Heartbeat'ten sonra çağrılır. */
export function syncRemoteEventWatchers(hosts: Host[]): void {
  const enabled = getBool("docker.events_enabled");
  const wanted = new Set(enabled ? hosts.filter(watchable).map((host) => host.id) : []);

  for (const [id, controller] of remoteWatchers) {
    if (wanted.has(id)) continue;
    controller.abort();
    remoteWatchers.delete(id);
  }

  for (const id of wanted) {
    if (remoteWatchers.has(id)) continue;
    const controller = new AbortController();
    remoteWatchers.set(id, controller);
    void watchRemote(id, controller.signal).finally(() => {
      if (remoteWatchers.get(id) === controller) remoteWatchers.delete(id);
    });
  }
}

function pause(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref?.();
    signal.addEventListener("abort", () => {
      clearTimeout(timer);
      resolve();
    }, { once: true });
  });
}

async function watchRemote(hostId: number, signal: AbortSignal): Promise<void> {
  // İlk bağlantıda geçmiş taranmaz: izleyici açılmadan önceki olaylar ya
  // zaten kayıtlı ya da ilgisiz. Kopmalardan sonra ise son görülenden devam.
  const state = { lastTs: Math.floor(Date.now() / 1000) };
  let delay = ILK_GECIKME_MS;

  while (!signal.aborted) {
    // Her turda taze kayıt: anahtar yenilenip yeniden kaydedilmiş bir sunucuda
    // eski sabitlemeyle bağlanmaya çalışmasın.
    const host = getHost(hostId);
    if (!watchable(host)) return;

    try {
      for await (const raw of agentStream<DockerEventRaw>(host, "docker.events", [state.lastTs], signal)) {
        delay = ILK_GECIKME_MS;
        await runWithHost(host.id, () => handle(raw, { host, state }));
      }
    } catch (error) {
      if (signal.aborted) return;
      console.error(`[docker-events] ${host.name}: ${error instanceof Error ? error.message : error}`);
    }

    await pause(delay, signal);
    delay = Math.min(delay * 2, AZAMI_GECIKME_MS);
  }
}
