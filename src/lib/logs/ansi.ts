/**
 * Log satırlarındaki ANSI kaçış dizilerinin çözümlenmesi (M3.34).
 *
 * ## Neden gerekiyor
 *
 * Log görüntüleyici kaçış dizilerini HAM METİN olarak basıyordu. Renkli log
 * üreten bir uygulamada (caddy, postgres, çoğu Node uygulaması) satırlar
 * `[32mINFO[0m sunucu hazır` gibi görünüyor — okunabilirliği artırmak için
 * konan renkler, tam tersine satırı okunmaz hale getiriyordu.
 *
 * ## Tanınmayan dizi ATILIR, basılmaz
 *
 * Bu modülün en önemli kararı. ANSI'de renkten başka çok şey var: imleci
 * taşımak, ekranı temizlemek, pencere başlığını değiştirmek. Bir log
 * görüntüleyicide bunların hiçbirinin karşılığı yok.
 *
 * Tanımadığını ham basmak, düzeltmeye çalıştığımız sorunun ta kendisi olurdu.
 * Bu yüzden: SGR (renk) dizileri yorumlanıyor, geri kalan HER kaçış dizisi
 * sessizce düşürülüyor.
 *
 * I/O yok, `@/` yolu yok — `node --test` altında doğrudan çalışsın diye saf.
 */

export type AnsiStyle = {
  /** Palet adı ("red", "brightgreen") ya da `#rrggbb`; yoksa null. */
  fg: string | null;
  bg: string | null;
  bold: boolean;
  dim: boolean;
  italic: boolean;
  underline: boolean;
};

export type AnsiSpan = AnsiStyle & { text: string };

const BOS: AnsiStyle = {
  fg: null,
  bg: null,
  bold: false,
  dim: false,
  italic: false,
  underline: false,
};

/** SGR 30-37 / 40-47 sırası; parlak biçimleri 90-97 ve 100-107. */
const RENKLER = ["black", "red", "green", "yellow", "blue", "magenta", "cyan", "white"];

/** xterm 256 renk paletindeki küp basamakları. */
const KUP = [0, 95, 135, 175, 215, 255];

function hex(r: number, g: number, b: number): string {
  const parca = (value: number) => Math.max(0, Math.min(255, value)).toString(16).padStart(2, "0");
  return `#${parca(r)}${parca(g)}${parca(b)}`;
}

/**
 * 256 renk paletindeki bir indeksi renk değerine çevirir.
 *
 * 0-15 adlandırılmış renkler (temaya göre değişirler, bu yüzden ad olarak
 * dönüyorlar) · 16-231 6×6×6 küp · 232-255 gri tonlar.
 */
function palet256(index: number): string {
  if (index < 8) return RENKLER[index];
  if (index < 16) return `bright${RENKLER[index - 8]}`;
  if (index < 232) {
    const offset = index - 16;
    return hex(KUP[Math.floor(offset / 36) % 6], KUP[Math.floor(offset / 6) % 6], KUP[offset % 6]);
  }
  const gri = 8 + (index - 232) * 10;
  return hex(gri, gri, gri);
}

/**
 * SGR parametrelerini biçime uygular.
 *
 * 38/48 uzantılı biçimleri (256 renk ve truecolor) tüketmek için indeks elle
 * ilerletiliyor: `38;5;196` üç parametre ama tek bir karar.
 */
function applySgr(style: AnsiStyle, params: number[]): AnsiStyle {
  let next = { ...style };

  for (let i = 0; i < params.length; i += 1) {
    const code = params[i];

    if (code === 0) {
      next = { ...BOS };
      continue;
    }
    if (code === 1) next.bold = true;
    else if (code === 2) next.dim = true;
    else if (code === 3) next.italic = true;
    else if (code === 4) next.underline = true;
    else if (code === 22) {
      next.bold = false;
      next.dim = false;
    } else if (code === 23) next.italic = false;
    else if (code === 24) next.underline = false;
    else if (code >= 30 && code <= 37) next.fg = RENKLER[code - 30];
    else if (code === 39) next.fg = null;
    else if (code >= 40 && code <= 47) next.bg = RENKLER[code - 40];
    else if (code === 49) next.bg = null;
    else if (code >= 90 && code <= 97) next.fg = `bright${RENKLER[code - 90]}`;
    else if (code >= 100 && code <= 107) next.bg = `bright${RENKLER[code - 100]}`;
    else if (code === 38 || code === 48) {
      const hedef = code === 38 ? "fg" : "bg";
      const kip = params[i + 1];

      if (kip === 5 && params.length > i + 2) {
        next[hedef] = palet256(params[i + 2]);
        i += 2;
      } else if (kip === 2 && params.length > i + 4) {
        next[hedef] = hex(params[i + 2], params[i + 3], params[i + 4]);
        i += 4;
      } else {
        // Eksik parametreli uzantı: geri kalanı yorumlamak rastgele renkler
        // üretirdi. Diziyi burada bırakmak dürüst.
        break;
      }
    }
    // Tanınmayan SGR kodları (blink, ters video, çerçeve…) sessizce atlanıyor.
  }

  return next;
}

const ESC = "\u001b";

/**
 * Bir satırı biçimli parçalara böler.
 *
 * Boş metinli parçalar dönmüyor ve ardışık aynı biçimli parçalar
 * birleştiriliyor: her karakteri ayrı bir `<span>` yapmak, uzun bir logda
 * tarayıcıyı dizlerinin üstüne çökertirdi.
 */
export function parseAnsi(input: string): AnsiSpan[] {
  const spans: AnsiSpan[] = [];
  let style: AnsiStyle = { ...BOS };
  let buffer = "";
  let i = 0;

  const push = () => {
    if (!buffer) return;
    const son = spans[spans.length - 1];
    if (son && sameStyle(son, style)) son.text += buffer;
    else spans.push({ ...style, text: buffer });
    buffer = "";
  };

  while (i < input.length) {
    const ch = input[i];

    if (ch !== ESC) {
      buffer += ch;
      i += 1;
      continue;
    }

    const next = input[i + 1];

    // Akış ortasında kesilmiş dizi: ESC son karakterse ya da gövdesi
    // tamamlanmamışsa, yarım diziyi ham basmak yerine düşürülüyor.
    if (next === undefined) break;

    if (next === "[") {
      // CSI: parametreler (0-9;:<=>?) → ara baytlar → son bayt (@ … ~).
      let j = i + 2;
      while (j < input.length && /[0-9;:<=>?]/.test(input[j])) j += 1;
      while (j < input.length && /[ -/]/.test(input[j])) j += 1;

      if (j >= input.length) break; // yarım kalmış CSI

      const final = input[j];
      const body = input.slice(i + 2, j);

      if (final === "m") {
        push();
        const params = body
          .split(";")
          .map((part) => (part === "" ? 0 : Number.parseInt(part, 10)))
          .map((value) => (Number.isFinite(value) ? value : 0));
        style = applySgr(style, params.length > 0 ? params : [0]);
      }
      // Diğer CSI'lar (imleç taşıma, ekran temizleme) ATILIYOR.

      i = j + 1;
      continue;
    }

    if (next === "]") {
      // OSC: BEL ya da ST (ESC \) ile biter; pencere başlığı gibi şeyler.
      let j = i + 2;
      while (j < input.length) {
        if (input[j] === "\u0007") break;
        if (input[j] === ESC && input[j + 1] === "\\") {
          j += 1;
          break;
        }
        j += 1;
      }
      i = j + 1;
      continue;
    }

    // İki baytlık diğer kaçışlar (ESC c, ESC = …) atlanıyor.
    i += 2;
  }

  push();
  return spans;
}

function sameStyle(a: AnsiStyle, b: AnsiStyle): boolean {
  return (
    a.fg === b.fg &&
    a.bg === b.bg &&
    a.bold === b.bold &&
    a.dim === b.dim &&
    a.italic === b.italic &&
    a.underline === b.underline
  );
}

/** Biçimi atıp yalnızca metni döndürür — log indirmede kullanılıyor. */
export function stripAnsi(input: string): string {
  return parseAnsi(input)
    .map((span) => span.text)
    .join("");
}
