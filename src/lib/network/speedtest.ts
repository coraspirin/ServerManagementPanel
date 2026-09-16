import "server-only";

import { getDb } from "@/lib/db/client";
import { isMockMode } from "@/lib/env";
import { serverT } from "@/lib/i18n/runtime";
import { getNumber, getString } from "@/lib/settings";

/**
 * M2.12 — hız testi.
 *
 * `speedtest-cli` ya da Ookla'nın ikilisi KURULMUYOR: ikisi de imaja onlarca
 * megabayt ekler, biri Python bağımlılığı getirir, diğeri lisans kabulü ister.
 * Bunun yerine Cloudflare'in herkese açık ölçüm uçları kullanılıyor — anahtar
 * istemiyor ve dünyanın her yerinde yakın bir kenar sunucusuna düşüyor.
 *
 * ÖLÇÜM SABİT SÜRELİ VE ÇOK AKIŞLI. İlk sürüm sabit bayt indiriyordu (25 MB) ve
 * tek TCP akışı kullanıyordu; üç ayrı sebeple yanlış sonuç veriyordu:
 *
 *   1. Hat ne kadar hızlıysa test o kadar kısa sürüyordu — 660 Mbit'lik bir
 *      hatta 25 MB yaklaşık ÜÇTE BİR saniye. Ölçüm penceresi bu kadar kısayken
 *      okunan şey hattın hızı değil, gürültü.
 *   2. TCP yavaş başlangıcı (slow start) ölçüme dahildi. Bağlantı tam hıza
 *      çıkana kadar geçen süre, kısa transferde toplamın çoğu.
 *   3. Tek akış hızlı bir hattı doyuramaz; gerçek istemciler 4-8 akış açar.
 *
 * Şimdi: her yön için ISINMA penceresi (baytları sayılmaz) + paralel akışlı
 * ÖLÇÜM penceresi. Sayılan bayt yalnızca ölçüm penceresinde gelen bayt, bölen
 * de o pencerenin gerçek uzunluğu.
 *
 * ÖLÇÜM SUNUCUSU BÜYÜK TEK İSTEKLERİ SINIRLIYOR. Gerçek uçta ölçüldü: 10 MB ve
 * üzeri `/__down` istekleri HTTP 429 + `Retry-After ≈ 3000-3500 sn` alıyor ve
 * bu ceza yaklaşık bir saat sürüyor; 5 MB ve altı istekler ceza sırasında bile
 * serbest geçiyor ve arka arkaya yüzlerce megabayt taşınabiliyor. Yani sınır
 * TOPLAM bayta değil İSTEK BOYUTUNA bakıyor. Varsayılan parça bu yüzden 5 MB.
 *
 * Parçayı daha da küçültmek bedava değil: aynı hatta 5 MB parça 845 Mbit
 * ölçerken 1 MB parça istek başına düşen ek yük yüzünden 466 Mbit ölçtü.
 *
 * Pencere ayrıca bir BAYT TAVANIYLA sınırlı (süre ya da tavan, hangisi önce
 * dolarsa): kotalı bağlantıda gigabit bir hattın 10 saniyede yön başına 1 GB
 * taşıması bir maliyet. Sunucu yine de reddederse sonuç sessizce "ölçülemedi"
 * olmuyor; ne olduğu ve ne kadar bekleneceği yazılıyor.
 *
 * Ölçüm ev bağlantısı için yeterince doğru; laboratuvar hassasiyeti değil
 * "sabah 40 Mbit'ti, şimdi 4" farkını görmek amaçlanıyor.
 */

/**
 * Isınma penceresi: baytların sayılmaya başlamasından önceki bölüm.
 *
 * Burada da indirme/yükleme sürüyor ama sayılmıyor; amaç TCP pencereleri
 * açılana kadar geçen süreyi ölçünün dışında bırakmak. `measureLatency`'deki
 * "ortalama değil en düşük" tercihinin aynı gerekçesi — bir kerelik kurulum
 * maliyeti hattın hızı değildir.
 *
 * İki sınır var ve HANGİSİ ÖNCE dolarsa ısınma orada biter. Yalnız süreyle
 * yapmak gigabit hatta 2 saniyede çeyrek gigabaytı kotaya yazıp çöpe atmak,
 * yalnız baytla yapmak ise 10 Mbit'lik bir hatta ısınmayı on saniyeye
 * uzatmak olurdu.
 */
const WARMUP_MS = 2_000;
const WARMUP_BYTES = 8_000_000;

/** Veri hiç akmazsa turu kesen mutlak üst sınır (ısınma + pencere üstüne). */
const HARD_SLACK_MS = 20_000;

export type SpeedtestResult = {
  id: number;
  ts: number;
  ok: boolean;
  downloadMbps: number | null;
  uploadMbps: number | null;
  pingMs: number | null;
  jitterMs: number | null;
  serverName: string;
  isp: string;
  error: string;
};

type Row = {
  id: number;
  ts: number;
  ok: number;
  download_mbps: number | null;
  upload_mbps: number | null;
  ping_ms: number | null;
  jitter_ms: number | null;
  server_name: string;
  isp: string;
  error: string;
};

function toResult(row: Row): SpeedtestResult {
  return {
    id: row.id,
    ts: row.ts,
    ok: row.ok === 1,
    downloadMbps: row.download_mbps,
    uploadMbps: row.upload_mbps,
    pingMs: row.ping_ms,
    jitterMs: row.jitter_ms,
    serverName: row.server_name,
    isp: row.isp,
    error: row.error,
  };
}

export function listSpeedtests(limit = 50): SpeedtestResult[] {
  return (
    getDb()
      .prepare("SELECT * FROM speedtest_results ORDER BY ts DESC LIMIT ?")
      .all(limit) as Row[]
  ).map(toResult);
}

function mbps(bytes: number, milliseconds: number): number {
  if (milliseconds <= 0) return 0;
  return Number(((bytes * 8) / (milliseconds / 1000) / 1_000_000).toFixed(2));
}

/**
 * Gecikme ve jitter.
 *
 * Küçük istekler atılıp EN DÜŞÜĞÜ gecikme sayılıyor: tek bir yavaş istek (TLS
 * el sıkışması, DNS) ortalamayı bozar ama hattın gerçek gecikmesini
 * değiştirmez.
 *
 * İlk örnek HİÇ SAYILMIYOR — bağlantı kurulumunun bedelini taşıyan tek örnek o
 * ve ölçtüğü şey hattın gecikmesi değil.
 *
 * Jitter için ardışık farkların ALT ORTANCASI alınıyor, ortalaması değil.
 * Ortalama tek bir aykırı örneğe teslim: ölçülen turlarda bir yavaş örnek
 * jitter'ı 1541 ms gösterdi, oysa aynı turda gecikme 32 ms ve komşu turların
 * jitter'ı 6-13 ms'ti.
 *
 * Örnek sayısını ARTIRMAK denendi ve GERİ ALINDI (6 → 9 → 6): dokuz örnekle
 * altı turun üçünde jitter bozuldu, üstelik turun kendisi 10 saniyeden 20
 * saniyeye çıktı. Bu istekler ardışık ve bir öncekinin bağlantıları hâlâ
 * kapanırken atılıyor; daha çok örnek daha çok kuyruk demek. Ölçüm ne kadar
 * uzarsa o kadar doğrulaşmıyor.
 *
 * KALAN SINIR: turlar arka arkaya koşturulursa jitter yine bozulabiliyor —
 * gecikme (en düşük) ve hız değerleri etkilenmiyor, yalnız jitter. Tek başına
 * koşan bir turda (gerçek kullanım: elle tıklama ya da altı saatlik iş) sorun
 * görülmedi.
 */
async function measureLatency(base: string): Promise<{ ping: number; jitter: number }> {
  const samples: number[] = [];

  for (let i = 0; i < 6; i++) {
    const started = Date.now();
    try {
      await fetch(`${base}?bytes=0&at=${started}`, {
        cache: "no-store",
        signal: AbortSignal.timeout(10_000),
      });
      // İlk tur bağlantıyı kuruyor; ölçüye girmiyor.
      if (i > 0) samples.push(Date.now() - started);
    } catch {
      // Tek bir başarısız örnek turu düşürmez.
    }
  }

  if (samples.length === 0) return { ping: 0, jitter: 0 };

  const deltas = samples
    .slice(1)
    .map((value, index) => Math.abs(value - samples[index]))
    .sort((a, b) => a - b);

  return {
    ping: Math.min(...samples),
    jitter: deltas.length > 0 ? deltas[(deltas.length - 1) >> 1] : 0,
  };
}

/** Ölçüm sunucusunun reddi — sonuca değil, hata metnine dönüşür. */
type Fault = { status: number; retryAfterSeconds: number };

type Measurement = { mbps: number; bytes: number; ms: number; fault: Fault | null };

/** Akışların ölçüm penceresiyle konuştuğu tek arayüz. */
type Meter = {
  signal: AbortSignal;
  /** Ölçüm penceresi başladıysa baytı sayar; ısınma sırasındaysa ısınmayı ilerletir. */
  add: (bytes: number) => void;
  /**
   * Sayılmayacak ama ısınmayı ilerletmesi gereken bayt.
   *
   * Yükleme için şart: orada `add` yalnızca pencerede BAŞLAMIŞ istekler için
   * çağrılıyor, pencerenin açılması ise `add`in içinde oluyordu — yani ısınma
   * kendi kendini bekleyip hiç bitmiyordu (ölçülen kusur: 5 saniyelik pencere
   * 28 saniye sürüyordu). Isınma turları artık buradan ilerliyor.
   */
  warm: (bytes: number) => void;
  /** Ölçüm penceresi başladı mı — yükleme tarafı bunu istek BAŞLARKEN soruyor. */
  counting: () => boolean;
  /** Sunucu isteği reddetti (429, 5xx …). */
  reject: (status: number, retryAfter: string | null) => void;
};

/**
 * N paralel akışı ısınma + ölçüm penceresi boyunca koşturur.
 *
 * Pencerenin bitişi zamanlayıcıyla değil VERİ GELDİKÇE hesaplanıyor: her yeni
 * bayt hem süre hem tavan sınırını yokluyor, dolan olursa akışlar kesiliyor.
 * Veri hiç akmazsa yokladıracak bir şey olmuyor, o yüzden bir de mutlak
 * zamanlayıcı var.
 *
 * Bölen olarak nominal süre değil, sayımın başladığı an ile SON SAYILAN baytın
 * arası kullanılıyor: `abort()` tam zamanında düşmez ve nominal süreyle bölmek
 * hattı olduğundan yavaş gösterirdi. Sayılan baytlar tam olarak bu aralıkta
 * geldi.
 */
async function meter(
  streams: number,
  windowMs: number,
  maxBytes: number,
  worker: (m: Meter) => Promise<void>,
): Promise<Measurement> {
  const controller = new AbortController();
  const startedAt = Date.now();

  let countFrom = 0; // 0 → ısınma sürüyor
  let warmed = 0;
  let bytes = 0;
  let lastCounted = 0;
  let fault: Fault | null = null;

  const advanceWarmup = (n: number, now: number) => {
    warmed += n;
    if (now - startedAt >= WARMUP_MS || warmed >= WARMUP_BYTES) countFrom = now;
  };

  const m: Meter = {
    signal: controller.signal,
    counting: () => countFrom > 0,
    warm: (n) => {
      if (countFrom === 0) advanceWarmup(n, Date.now());
    },
    add: (n) => {
      const now = Date.now();

      if (countFrom === 0) {
        advanceWarmup(n, now);
        return;
      }

      bytes += n;
      lastCounted = now;
      if (now - countFrom >= windowMs || bytes >= maxBytes) controller.abort();
    },
    reject: (status, retryAfter) => {
      // İlk ret saklanıyor: sonrakiler zaten aynı sebebin tekrarı.
      if (!fault) fault = { status, retryAfterSeconds: Number(retryAfter ?? 0) || 0 };
    },
  };

  const timer = setTimeout(
    () => controller.abort(),
    WARMUP_MS + windowMs + HARD_SLACK_MS,
  );
  try {
    await Promise.all(Array.from({ length: streams }, () => worker(m)));
  } finally {
    clearTimeout(timer);
    controller.abort();
  }

  const ms = lastCounted > 0 ? lastCounted - countFrom : 0;
  return { bytes, ms, mbps: mbps(bytes, ms), fault };
}

/**
 * Sunucunun reddini kullanıcının anlayacağı bir cümleye çevirir.
 *
 * "Ölçüm sunucusuna ulaşılamıyor" demek yanlış olurdu: sunucuya ulaşıldı, kotayı
 * doldurduğumuzu söyledi. Yanlış teşhis, kullanıcıyı olmayan bir ağ sorununu
 * aramaya gönderir.
 */
function describeFault(fault: Fault, direction: string): string {
  if (fault.status === 429) {
    const minutes = Math.ceil(fault.retryAfterSeconds / 60);
    return (
      serverT("speedtestLib.rateLimited", { direction }) +
      (minutes > 0 ? serverT("speedtestLib.retryIn", { minutes }) : "") +
      serverT("speedtestLib.sizeHint", { direction })
    );
  }
  return serverT("speedtestLib.rejected", { direction, status: fault.status });
}

/**
 * Tek indirme akışı: süre dolana kadar parça iste, gövdeyi SONUNA KADAR oku.
 *
 * Gövdeyi okumadan geçmek yalnızca başlıkların gelme süresini ölçmek olurdu ve
 * sonuç saçma derecede yüksek çıkardı.
 */
async function downloadStream(
  base: string,
  chunkBytes: number,
  seen: { server: string },
  m: Meter,
): Promise<void> {
  while (!m.signal.aborted) {
    try {
      const response = await fetch(`${base}/__down?bytes=${chunkBytes}`, {
        cache: "no-store",
        signal: m.signal,
      });
      if (!response.ok) {
        m.reject(response.status, response.headers.get("retry-after"));
        return;
      }
      if (!response.body) return;

      // Hangi kenar sunucusuna karşı ölçtüğümüz sonucun yorumu için gerekli.
      if (!seen.server) seen.server = response.headers.get("cf-ray")?.split("-")[1] ?? "";

      for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
        m.add(chunk.byteLength);
        if (m.signal.aborted) return;
      }
    } catch {
      // Süre dolduğunda gelen AbortError BEKLENEN bitiş, hata değil. Gerçek bir
      // ağ hatası da yalnızca bu akışı düşürür; diğerleri ölçmeye devam eder.
      return;
    }
  }
}

/**
 * Tek yükleme akışı.
 *
 * İndirmenin aksine yolda kaç bayt olduğu bilinmiyor, o yüzden yalnızca
 * TAMAMLANMIŞ istekler sayılıyor — ve istek ısınma penceresinde BAŞLADIYSA
 * sayılmıyor: baytlarının bir kısmı sayılmayan pencerede gitmişti.
 */
async function uploadStream(
  base: string,
  // `<ArrayBuffer>` şart: sade `Uint8Array` artık `ArrayBufferLike` demek ve
  // `fetch`in gövde tipi (BufferSource) onu kabul etmiyor.
  payload: Uint8Array<ArrayBuffer>,
  m: Meter,
): Promise<void> {
  while (!m.signal.aborted) {
    const inWindow = m.counting();
    try {
      const response = await fetch(`${base}/__up`, {
        method: "POST",
        body: payload,
        cache: "no-store",
        signal: m.signal,
      });
      if (!response.ok) {
        m.reject(response.status, response.headers.get("retry-after"));
        return;
      }
      // Gövde tüketilmezse bağlantı yeniden kullanılamaz ve her tur yeni bir
      // TLS el sıkışması ödenir.
      await response.arrayBuffer();
    } catch {
      return;
    }
    // Pencerede başlamayan tur SAYILMAZ ama ısınmayı ilerletmek zorunda —
    // yoksa pencere hiç açılmaz.
    if (inWindow) m.add(payload.byteLength);
    else m.warm(payload.byteLength);
  }
}

export async function runSpeedtest(): Promise<SpeedtestResult> {
  const now = Math.floor(Date.now() / 1000);
  const base = getString("speedtest.endpoint").trim().replace(/\/+$/, "");
  const downloadBytes = getNumber("speedtest.download_bytes");
  const uploadBytes = getNumber("speedtest.upload_bytes");
  const streams = Math.min(8, Math.max(1, Math.round(getNumber("speedtest.streams"))));
  const windowMs = Math.min(30, Math.max(5, getNumber("speedtest.duration_seconds"))) * 1000;
  const maxBytes = getNumber("speedtest.max_bytes");

  const save = (
    partial: Partial<Omit<SpeedtestResult, "id" | "ts">> & { ok: boolean },
  ): SpeedtestResult => {
    const result = getDb()
      .prepare(
        `INSERT INTO speedtest_results
           (ts, ok, download_mbps, upload_mbps, ping_ms, jitter_ms, server_name, isp, error)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        now,
        partial.ok ? 1 : 0,
        partial.downloadMbps ?? null,
        partial.uploadMbps ?? null,
        partial.pingMs ?? null,
        partial.jitterMs ?? null,
        partial.serverName ?? "",
        partial.isp ?? "",
        partial.error ?? "",
      );

    return {
      id: Number(result.lastInsertRowid),
      ts: now,
      ok: partial.ok,
      downloadMbps: partial.downloadMbps ?? null,
      uploadMbps: partial.uploadMbps ?? null,
      pingMs: partial.pingMs ?? null,
      jitterMs: partial.jitterMs ?? null,
      serverName: partial.serverName ?? "",
      isp: partial.isp ?? "",
      error: partial.error ?? "",
    };
  };

  if (isMockMode()) {
    return save({
      ok: true,
      downloadMbps: 92.4,
      uploadMbps: 18.7,
      pingMs: 12,
      jitterMs: 2.4,
      serverName: "MOCK_MODE",
      isp: "sahte",
    });
  }

  try {
    const latency = await measureLatency(`${base}/__down`);

    const seen = { server: "" };
    const download = await meter(streams, windowMs, maxBytes, (m) =>
      downloadStream(base, downloadBytes, seen, m),
    );
    if (download.bytes === 0) {
      throw new Error(
        download.fault
          ? describeFault(download.fault, serverT("speedtestLib.download"))
          : serverT("speedtestLib.downloadFailed"),
      );
    }

    // `Buffer` değil `Uint8Array`: `fetch`in gövde tipi (BodyInit) Buffer'ı
    // tanımıyor ve zaten sıfırla dolu geliyor.
    const payload = new Uint8Array(uploadBytes);
    let upload = await meter(streams, windowMs, maxBytes, (m) =>
      uploadStream(base, payload, m),
    );

    if (upload.bytes === 0) {
      if (upload.fault) throw new Error(describeFault(upload.fault, serverT("speedtestLib.upload")));

      // Pencerede hiçbir yükleme TAMAMLANAMADIYSA (çok yavaş hat + büyük parça)
      // sıfır yazmak yanlış olurdu: ölçüm başarısız değil, parça büyük. Tek
      // seferlik ölçüme düşülüyor — eski sürümün yaptığı şeyin aynısı.
      const started = Date.now();
      const response = await fetch(`${base}/__up`, {
        method: "POST",
        body: payload,
        cache: "no-store",
        signal: AbortSignal.timeout(windowMs * 4),
      });
      if (!response.ok) {
        throw new Error(
          describeFault(
            {
              status: response.status,
              retryAfterSeconds: Number(response.headers.get("retry-after") ?? 0) || 0,
            },
            serverT("speedtestLib.upload"),
          ),
        );
      }
      await response.arrayBuffer();
      const ms = Date.now() - started;
      upload = { bytes: uploadBytes, ms, mbps: mbps(uploadBytes, ms), fault: null };
    }

    return save({
      ok: true,
      downloadMbps: download.mbps,
      uploadMbps: upload.mbps,
      pingMs: latency.ping,
      jitterMs: latency.jitter,
      serverName: seen.server,
      isp: "",
    });
  } catch (error) {
    return save({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/** Saklama süresini aşan ölçümleri siler. */
export function pruneSpeedtests(): number {
  const days = getNumber("speedtest.retention_days");
  const cutoff = Math.floor(Date.now() / 1000) - days * 86400;
  return Number(
    getDb().prepare("DELETE FROM speedtest_results WHERE ts < ?").run(cutoff).changes,
  );
}
