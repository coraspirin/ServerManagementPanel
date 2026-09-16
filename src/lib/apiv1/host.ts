import "server-only";
import { serverT } from "@/lib/i18n/runtime";

import { callHelper, helperConfigured, type HelperAction } from "@/lib/host/helper";
import { auditAction, completeIdempotent, type IdempotencyContext } from "./action";
import type { ApiActor } from "./guard";
import { apiError, apiOk } from "./respond";

/**
 * T12 — host eylemlerinin ortak gövdesi.
 *
 * Üç uç (power / services / compose) aynı beş adımı yapıyor: helper kurulu mu,
 * çağır, tekrar reddini ayırt et, audit'e yaz, yanıtı idempotency'ye bağla.
 * Route'lara kopyalansaydı biri er ya da geç bir adımı atlardı.
 */

/**
 * Helper "tekrar" reddini ayırt eden im.
 *
 * `PROTOCOL.md`: aynı `id` son 5 dakikada görülmüşse istek reddedilir. Bu bir
 * HATA DEĞİL, idempotency garantisinin ta kendisi — ama helper bunu diğer
 * retlerle aynı biçimde bildiriyor, o yüzden metinden ayrıştırmak gerekiyor.
 */
function isReplayRejection(error: string): boolean {
  const lower = error.toLocaleLowerCase("tr");
  return lower.includes("tekrar") || lower.includes("replay") || lower.includes("daha önce"); // i18n-ignore — host-helper metni
}

export async function runHelperAction(options: {
  actor: ApiActor;
  action: HelperAction;
  args: Record<string, unknown>;
  idempotency: IdempotencyContext;
  auditAction: string;
  targetId: string;
  detail?: string;
  timeoutMs?: number;
}): Promise<Response> {
  if (!helperConfigured()) {
    // 503 korunuyor (iç uçla aynı): bu bir yapılandırma eksiği, bir yetki ya
    // da istek hatası değil — ve mesaj ne yapılacağını söylüyor.
    return apiError(
      "upstream_error",
      serverT("apiv1.helperMissing"),
      { status: 503 },
    );
  }

  const response = await callHelper(
    options.action,
    options.args,
    { username: options.actor.username, userId: options.actor.userId },
    options.timeoutMs,
    // Idempotency açıksa helper istek kimliği ANAHTARDAN türetiliyor; aynı
    // anahtarla gelen ikinci istek helper'ın kendi tekrar penceresine çarpar.
    options.idempotency.mode === "on" ? options.idempotency.helperRequestId : undefined,
  );

  if (!response.ok) {
    const error = response.error ?? serverT("apiv1.helperRejected");

    if (options.idempotency.mode === "on" && isReplayRejection(error)) {
      // Belirsizlik DEĞİL, kesinlik: helper aynı id'yi daha önce gördüyse ilk
      // komut çalışmıştır. Panel yeniden başlamış ve bellekteki eşleme
      // kaybolmuş olsa bile garanti burada duruyor.
      return apiError(
        "conflict",
        serverT("apiv1.alreadyRun"),
      );
    }

    auditAction(options.actor, {
      action: options.auditAction,
      targetType: "host",
      targetId: options.targetId,
      detail: `${options.detail ?? ""} ${error}`.trim(),
      result: "error",
    });

    return apiError("upstream_error", error);
  }

  auditAction(options.actor, {
    action: options.auditAction,
    targetType: "host",
    targetId: options.targetId,
    detail: options.detail,
  });

  return completeIdempotent(
    options.idempotency,
    options.actor,
    apiOk({
      ok: true,
      exitCode: response.exitCode ?? 0,
      // stdout/stderr HAM geçiyor ama bunlar helper'ın çalıştırdığı komutun
      // çıktısı — istek başlığı ya da token taşımıyorlar (§Loglama).
      stdout: response.stdout ?? "",
      stderr: response.stderr ?? "",
      durationMs: response.durationMs ?? 0,
    }),
  );
}
