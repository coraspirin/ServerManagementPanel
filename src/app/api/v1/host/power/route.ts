import { beginIdempotent } from "@/lib/apiv1/action";
import { guardV1 } from "@/lib/apiv1/guard";
import { runHelperAction } from "@/lib/apiv1/host";
import { readJsonBody } from "@/lib/apiv1/parse";
import { apiError } from "@/lib/apiv1/respond";
import type { HelperAction } from "@/lib/host/helper";
import { getNumber } from "@/lib/settings";

export const dynamic = "force-dynamic";

const ACTIONS: Record<string, HelperAction> = {
  reboot: "power.reboot",
  shutdown: "power.shutdown",
  cancel: "power.cancel",
};

/**
 * Sunucu gücü — yeniden başlat / kapat / planlananı iptal et.
 *
 * `host.power` izni gerekiyor ve bu izin cihaz token'larına HİÇBİR KOŞULDA
 * verilmiyor (Faz F): çalınan bir telefon sunucuyu kapatabilmemeli.
 *
 * İki bağımsız kapı var ve ikisi de gerekli: buradaki RBAC izni ve host'taki
 * `/etc/panel-helper/allow.conf`. Panel ele geçirilse bile ikincisi durur —
 * bu yüzden buradaki kontrol "güvenlik" değil, yetkisiz çağrıyı erken kesmek.
 */
export async function POST(request: Request) {
  const guard = await guardV1(request, "host.power");
  if (!guard.ok) return guard.response;

  const idem = beginIdempotent(request, guard.actor);
  if (idem.kind === "invalid") return idem.response;
  if (idem.kind === "replay") return idem.response;

  const body = await readJsonBody<{ action?: unknown; delayMinutes?: unknown }>(
    request,
    getNumber("api.max_body_bytes"),
  );
  if (!body.ok) return body.response;

  const requested = String(body.body.action ?? "");
  const action = ACTIONS[requested];
  if (!action) {
    return apiError(
      "invalid_request",
      `geçersiz eylem. Geçerli değerler: ${Object.keys(ACTIONS).join(", ")}`,
    );
  }

  const rawDelay = Number(body.body.delayMinutes ?? 1);
  const delayMinutes = Number.isFinite(rawDelay) ? Math.min(Math.max(Math.trunc(rawDelay), 0), 1440) : 1;

  return runHelperAction({
    actor: guard.actor,
    action,
    /*
     * Helper `delaySeconds` bekliyor (panel-helper.py `_delay`), v1 ise
     * `delayMinutes` kabul ediyor — dışarıdaki isim insanın düşündüğü birim,
     * içerideki protokolün istediği birim. Çeviri tam da bu katmanın işi.
     *
     * `cancel` gecikme almıyor; göndermek helper'ın argüman şemasına takılırdı.
     */
    args: action === "power.cancel" ? {} : { delaySeconds: delayMinutes * 60 },
    idempotency: idem.context,
    auditAction: `host.${requested}`,
    targetId: requested,
    detail: action === "power.cancel" ? "planlanan iptal edildi" : `${delayMinutes} dk sonra`,
  });
}
