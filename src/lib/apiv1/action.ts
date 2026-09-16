import "server-only";
import { serverT } from "@/lib/i18n/runtime";

import { audit } from "@/lib/auth/audit";
import { getNumber } from "@/lib/settings";
import type { ApiActor } from "./guard";
import { helperRequestId, isValidKey, recall, remember } from "./idempotency";
import { tokenAuditTag } from "./redact";
import { apiError } from "./respond";

/**
 * T12 — v1 eylem uçlarının ortak kabuğu.
 *
 * Üç şey her eylemde tekrar ediyor ve üçü de atlanırsa fark edilmesi zor:
 * audit kaydı, idempotency ve helper istek kimliği. Route'lara bırakılsaydı
 * yeni bir uç eklerken biri unutulurdu.
 */

/**
 * Audit kaydı — aktör etiketiyle.
 *
 * `detail` alanına token'ın ADI ve ÖNEKİ giriyor, değeri asla. Böylece
 * Denetim ekranında panelden yapılan işlem ile token'dan yapılan ayırt
 * edilebiliyor: "bu container'ı gece 3'te kim yeniden başlattı" sorusunun
 * cevabı "admin" değil, "admin'in grafana anahtarı" olabilir.
 */
export function auditAction(
  actor: ApiActor,
  entry: { action: string; targetType?: string; targetId?: string; detail?: string; result?: "ok" | "error" },
): void {
  const tag =
    actor.via === "token" && actor.tokenName && actor.tokenPrefix
      ? `${tokenAuditTag(actor.tokenName, actor.tokenPrefix)} `
      : "";

  audit({
    userId: actor.userId,
    username: actor.username,
    action: entry.action,
    targetType: entry.targetType,
    targetId: entry.targetId,
    detail: `${tag}${entry.detail ?? ""}`.trim(),
    ip: actor.ip,
    result: entry.result ?? "ok",
  });
}

export type IdempotencyContext =
  | { mode: "off" }
  | { mode: "on"; key: string; helperRequestId: string; windowSeconds: number };

export type IdempotencyResult =
  | { kind: "replay"; response: Response }
  | { kind: "proceed"; context: IdempotencyContext }
  | { kind: "invalid"; response: Response };

/**
 * `Idempotency-Key` başlığını çözer ve varsa kayıtlı yanıtı döndürür.
 *
 * Başlık yoksa `{mode:"off"}` — garanti YOK ve bu bilinçli. Opt-in olmasının
 * sebebi anahtarı istemcinin üretmesi gerekmesi.
 */
export function beginIdempotent(request: Request, actor: ApiActor): IdempotencyResult {
  const key = request.headers.get("idempotency-key");
  if (key === null) return { kind: "proceed", context: { mode: "off" } };

  if (!isValidKey(key)) {
    return {
      kind: "invalid",
      response: apiError(
        "invalid_request",
        serverT("apiv1.idempotencyFormat"),
      ),
    };
  }

  const windowSeconds = getNumber("api.idempotency_window_seconds");
  const cached = recall(actor.userId, key, windowSeconds);

  if (cached) {
    return {
      kind: "replay",
      response: new Response(cached.body, {
        status: cached.status,
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "no-store",
          "X-Panel-Api-Version": "1",
          // İstemci yanıtın tekrar mı yoksa yeni bir çalıştırma mı olduğunu
          // bilmeli; ikisi aynı görünseydi "komut iki kez mi gitti" sorusu
          // cevapsız kalırdı.
          "Idempotency-Replayed": "true",
        },
      }),
    };
  }

  return {
    kind: "proceed",
    context: {
      mode: "on",
      key,
      helperRequestId: helperRequestId(key, process.env.HELPER_SECRET ?? ""),
      windowSeconds,
    },
  };
}

/** Yanıtı anahtara bağlar. Gövde okunduğu için yanıtın klonu döner. */
export async function completeIdempotent(
  context: IdempotencyContext,
  actor: ApiActor,
  response: Response,
): Promise<Response> {
  if (context.mode === "off") return response;

  const body = await response.clone().text();
  remember(actor.userId, context.key, { status: response.status, body }, context.windowSeconds);
  return response;
}
