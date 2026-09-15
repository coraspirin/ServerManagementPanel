/**
 * Image katmanlarının okunur hâle getirilmesi (M3.43).
 *
 * ## Neden gerekiyor
 *
 * Katman listesi ham `CreatedBy` metnini basıyordu ve o metin Docker'ın iç
 * biçimi — okunur olması diye bir kaygısı yok:
 *
 *     /bin/sh -c #(nop)  CMD ["node" "server.js"]
 *     RUN /bin/sh -c apk add --no-cache tini # buildkit
 *     COPY dir:9f3a1c… in /app
 *
 * Kullanıcının sorduğu soru ise basit: **"bu imaj neden bu kadar yer
 * kaplıyor?"** Cevap neredeyse her zaman bir ya da iki `RUN` katmanında ve
 * ham metin bunu göstermiyordu.
 *
 * Bu modül her katmandan üç şey çıkarıyor: hangi Dockerfile komutu, komutun
 * argümanı, ve katmanın imajın toplamındaki payı.
 *
 * I/O yok, `@/` yolu yok — `node --test` altında doğrudan çalışsın diye saf.
 */

/** Katman girdisinin ihtiyaç duyulan alanları — `ImageLayer`'ın dar görünümü. */
export type LayerInput = {
  id: string;
  createdAt: number;
  createdBy: string;
  sizeBytes: number;
  comment: string;
};

export type LayerView = {
  /** Tabandan sayılan sıra: en eski katman 1. */
  index: number;
  instruction: string;
  /** Komutun argümanı; boşsa komut tek başına anlamlı (ör. bazı CMD'ler). */
  argument: string;
  sizeBytes: number;
  /** En büyük katmana göre oran (0-100) — çubuk genişliği. */
  widthPct: number;
  /** İmajın toplamındaki pay (0-100). */
  sharePct: number;
  /** İmajın boyutunu domine eden katman mı. */
  large: boolean;
  createdAt: number;
  id: string;
};

/**
 * Dockerfile komutları.
 *
 * `RUN` listede YOK: Docker onu `CreatedBy`'ye komut adıyla yazmıyor, doğrudan
 * kabuk çağrısı olarak bırakıyor (`/bin/sh -c …`). Aşağıda ayrıca ele alınıyor.
 */
const KOMUTLAR = [
  "ADD",
  "ARG",
  "CMD",
  "COPY",
  "ENTRYPOINT",
  "ENV",
  "EXPOSE",
  "HEALTHCHECK",
  "LABEL",
  "MAINTAINER",
  "ONBUILD",
  "SHELL",
  "STOPSIGNAL",
  "USER",
  "VOLUME",
  "WORKDIR",
  "RUN",
] as const;

/**
 * Ham `CreatedBy` metninden komutu ve argümanını ayırır.
 *
 * Üç biçimle karşılaşılıyor:
 *
 * | Ham metin | Sonuç |
 * |---|---|
 * | `CMD ["node"]` | `CMD` + `["node"]` |
 * | `/bin/sh -c #(nop)  ENV A=1` | `ENV` + `A=1` |
 * | `/bin/sh -c apk add tini` | `RUN` + `apk add tini` |
 * | `RUN /bin/sh -c npm ci # buildkit` | `RUN` + `npm ci` |
 *
 * Son satır BuildKit'in biçimi: komut adını yazıyor ama arkasına yine kabuk
 * çağrısını ve bir `# buildkit` kuyruğunu ekliyor. İkisini de temizlemek,
 * aynı `RUN` satırının derleyiciye göre farklı görünmesini engelliyor.
 */
export function parseInstruction(createdBy: string): { instruction: string; argument: string } {
  let text = (createdBy ?? "").trim();
  if (!text) return { instruction: "", argument: "" };

  // Eski Docker'ın "değişiklik üretmeyen" işaretçisi; komuttan önce geliyor.
  text = text.replace(/^\/bin\/sh\s+-c\s+#\(nop\)\s*/, "").trim();

  // BuildKit kuyruğu: satır sonundaki `# buildkit` yorumunu at.
  text = text.replace(/\s*#\s*buildkit\s*$/i, "").trim();

  for (const komut of KOMUTLAR) {
    if (text === komut) return { instruction: komut, argument: "" };
    if (text.startsWith(komut + " ")) {
      let argument = text.slice(komut.length + 1).trim();
      // `RUN /bin/sh -c …` → kabuk çağrısı gürültü, komutun kendisi değil.
      if (komut === "RUN") argument = argument.replace(/^\/bin\/sh\s+-c\s+/, "").trim();
      return { instruction: komut, argument };
    }
  }

  // Komut adı yoksa ve kabuk çağrısıysa: bu bir RUN.
  // `[\s\S]` — `s` bayragi yerine: cok satirli RUN komutlari da
  // eslesmeli ama regex bayragi hedef ES surumune bagimli.
  const kabuk = text.match(/^\/bin\/sh\s+-c\s+([\s\S]*)$/);
  if (kabuk) return { instruction: "RUN", argument: kabuk[1].trim() };

  return { instruction: "", argument: text };
}

/**
 * Bir katmanın "büyük" sayılması için gereken pay ve taban.
 *
 * İki koşul birlikte: imajın **beşte birinden fazlası** olmalı VE en az
 * 10 MB. Yalnızca oran kullanılsaydı 40 MB'lık bir imajın 9 MB'lık katmanı
 * "büyük" damgası yerdi — oysa orada budanacak bir şey yok. Yalnızca mutlak
 * eşik kullanılsaydı 2 GB'lık bir imajda her katman büyük görünürdü.
 */
const BUYUK_PAY = 20;
const BUYUK_TABAN = 10 * 1024 * 1024;

/**
 * Katmanları görüntüleme sırasına ve ölçülerine çevirir.
 *
 * ⚠️ Docker `/history` çıktısını **en yeniden en eskiye** veriyor. Numaralama
 * bunun tersi: taban katman 1. Kullanıcı bir imajı Dockerfile'ı okur gibi
 * düşünüyor ve orada ilk satır tabandır.
 *
 * Dizinin sırası DEĞİŞTİRİLMİYOR — ekranda yığın, üstteki katman üstte olacak
 * şekilde çiziliyor; yalnızca numaralar tabandan sayılıyor.
 */
export function buildLayerView(layers: LayerInput[]): LayerView[] {
  const enBuyuk = layers.reduce((max, layer) => Math.max(max, layer.sizeBytes), 0);
  const toplam = layers.reduce((sum, layer) => sum + layer.sizeBytes, 0);

  return layers.map((layer, index) => {
    const { instruction, argument } = parseInstruction(layer.createdBy || layer.comment);
    const sharePct = toplam > 0 ? (layer.sizeBytes / toplam) * 100 : 0;

    return {
      index: layers.length - index,
      instruction: instruction || "—",
      argument,
      sizeBytes: layer.sizeBytes,
      // Sıfır baytlık katmanlar da bir çubuk alıyor: hiç çizmemek onları
      // listede kaybederdi, oysa `ENV`/`CMD` gibi satırlar imajın ne yaptığını
      // anlatan asıl bilgi.
      widthPct: enBuyuk > 0 ? (layer.sizeBytes / enBuyuk) * 100 : 0,
      sharePct,
      large: sharePct >= BUYUK_PAY && layer.sizeBytes >= BUYUK_TABAN,
      createdAt: layer.createdAt,
      id: layer.id,
    };
  });
}

/** Toplam katman sayısı ve boyutu — başlıkta gösteriliyor. */
export function layerTotals(layers: LayerInput[]): { count: number; sizeBytes: number } {
  return {
    count: layers.length,
    sizeBytes: layers.reduce((sum, layer) => sum + layer.sizeBytes, 0),
  };
}
