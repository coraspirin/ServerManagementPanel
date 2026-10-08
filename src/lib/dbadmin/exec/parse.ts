/**
 * İstemci CLI çıktılarını `{columns, rows}`a çevirir.
 *
 * Envanterdeki sunuculara sürücüyle değil `mysql`/`psql` ile erişiliyor (bkz.
 * `runner.ts`); sonuç metin olarak geliyor. Değerler string kalıyor — tablo
 * ekranı zaten metin gösteriyor.
 */

export type Parsed = { columns: string[]; rows: (string | null)[][] };

const MYSQL_ESCAPES: Record<string, string> = { "0": "\0", t: "\t", n: "\n", "\\": "\\" };

/**
 * `mysql --batch` çıktısı: başlıklı, sekmeyle ayrılmış. Değerin içindeki
 * sekme/satır sonu/ters bölü kaçırılmış geliyor, bu yüzden satırlara bölmek
 * güvenli. NULL düz "NULL" metni olarak yazılıyor — "NULL" içerikli bir
 * metinle ayırt edilemiyor; ekran için kabul edilebilir.
 */
export function parseMysqlBatch(text: string): Parsed {
  const lines = text.replace(/\r?\n$/, "").split("\n");
  if (lines.length === 0 || lines[0] === "") return { columns: [], rows: [] };

  const unescape = (field: string) =>
    field.replace(/\\(.)/g, (whole, char: string) => MYSQL_ESCAPES[char] ?? whole);

  const columns = lines[0].split("\t").map(unescape);
  const rows = lines
    .slice(1)
    .map((line) => line.split("\t").map((field) => (field === "NULL" ? null : unescape(field))));
  return { columns, rows };
}

/**
 * RFC 4180 CSV (`psql --csv`). psql NULL'u tırnaksız boş alan, boş metni
 * `""` olarak yazıyor; tırnak bilgisi bu yüzden alan bazında tutuluyor.
 */
export function parseCsv(text: string): Parsed {
  const records: (string | null)[][] = [];
  let record: (string | null)[] = [];
  let field = "";
  let quoted = false;
  let inQuotes = false;

  const pushField = () => {
    record.push(field === "" && !quoted ? null : field);
    field = "";
    quoted = false;
  };

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (inQuotes) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"') {
      inQuotes = true;
      quoted = true;
    } else if (char === ",") {
      pushField();
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[index + 1] === "\n") index += 1;
      pushField();
      records.push(record);
      record = [];
    } else {
      field += char;
    }
  }
  if (field !== "" || quoted || record.length > 0) {
    pushField();
    records.push(record);
  }

  if (records.length === 0) return { columns: [], rows: [] };
  return {
    columns: records[0].map((value) => value ?? ""),
    rows: records.slice(1),
  };
}

/**
 * psql'in satır döndürmeyen komut sonrası yazdığı etiket ("UPDATE 3",
 * "INSERT 0 1", "CREATE TABLE"). Etkilenen satır sayısı son sayı.
 */
export function parsePgTag(text: string): { tag: string; affected: number | null } | null {
  const line = text.trim();
  if (!/^[A-Z][A-Z ]+( \d+)*$/.test(line)) return null;
  const match = line.match(/(\d+)$/);
  return { tag: line, affected: match ? Number(match[1]) : null };
}
