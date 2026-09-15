import { apiError } from "./respond";

/**
 * T12 — gövde okuma ve sorgu ayrıştırma.
 *
 * Gövde sınırı İKİ YERE bölünmüş durumda ve bu bilerek: `guardV1` yalnızca
 * başlıklara bakabiliyor (gövdeyi okusaydı route'un elinden alırdı), buradaki
 * akış sayacı ise gerçek boyutu ölçüyor. İkisi birbirinin yedeği değil —
 * `Content-Length` yalan söyleyebilir ya da `chunked` kodlamada hiç
 * gönderilmez; o durumda tek koruma buradaki sayaç.
 */

export type BodyResult<T> = { ok: true; body: T } | { ok: false; response: Response };

export async function readJsonBody<T = Record<string, unknown>>(
  request: Request,
  maxBytes: number,
): Promise<BodyResult<T>> {
  /*
   * Content-Type kontrolü BURADA, guardV1'de değil.
   *
   * guardV1 her isteği görüyor ama hangisinin gövde beklediğini bilmiyor;
   * oraya konsaydı ya gövdesiz POST'ları da reddederdi ya da "gövde var mı"
   * tahmini yapmak zorunda kalırdı. Gövdeyi İSTEYEN fonksiyonda olması
   * kuralın atlanmasını imkânsız kılıyor: JSON okumak isteyen her route
   * buradan geçiyor.
   *
   * Yalnızca gerçekten gövde varken bakılıyor — `Content-Type`siz bir
   * gövdesiz POST meşru.
   */
  const contentType = request.headers.get("content-type") ?? "";
  const hasBody =
    request.body !== null &&
    (request.headers.get("content-length") !== "0" || contentType !== "");

  if (hasBody && contentType !== "" && !contentType.toLowerCase().includes("application/json")) {
    return {
      ok: false,
      response: apiError("invalid_request", "gövde application/json olmalı", { status: 415 }),
    };
  }

  // Ucuz ön eleme: başlık güveniliyorsa gövde hiç okunmadan kesilir. Tek
  // başına YETMEZ — başlık yalan söyleyebilir ya da `chunked` kodlamada hiç
  // gönderilmez; asıl kontrol aşağıdaki akış sayacı.
  const declared = Number(request.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > maxBytes) {
    return {
      ok: false,
      response: apiError("invalid_request", `gövde ${maxBytes} bayt sınırını aşıyor`, {
        status: 413,
      }),
    };
  }

  const raw = await readLimited(request, maxBytes);
  if (!raw.ok) return raw;

  if (raw.text.trim() === "") return { ok: true, body: {} as T };

  try {
    return { ok: true, body: JSON.parse(raw.text) as T };
  } catch {
    return { ok: false, response: apiError("invalid_request", "gövde geçerli JSON değil") };
  }
}

async function readLimited(
  request: Request,
  maxBytes: number,
): Promise<{ ok: true; text: string } | { ok: false; response: Response }> {
  if (!request.body) return { ok: true, text: "" };

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      return {
        ok: false,
        response: apiError("invalid_request", `gövde ${maxBytes} bayt sınırını aşıyor`, {
          status: 413,
        }),
      };
    }
    chunks.push(value);
  }

  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { ok: true, text: new TextDecoder().decode(merged) };
}
