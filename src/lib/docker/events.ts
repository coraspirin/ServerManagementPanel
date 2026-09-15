import "server-only";

import http from "node:http";

import { announce } from "@/lib/alerts/announce";
import { recordEvent } from "@/lib/alerts/store";
import { isMockMode } from "@/lib/env";
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
async function handle(raw: DockerEventRaw): Promise<void> {
  const event = classify(raw);
  if (!event) return;

  sonZaman = Math.max(sonZaman, event.ts);

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
