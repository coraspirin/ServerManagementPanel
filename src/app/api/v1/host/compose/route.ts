import { serverT } from "@/lib/i18n/runtime";
import { beginIdempotent } from "@/lib/apiv1/action";
import { guardV1 } from "@/lib/apiv1/guard";
import { runHelperAction } from "@/lib/apiv1/host";
import { readJsonBody } from "@/lib/apiv1/parse";
import { apiError } from "@/lib/apiv1/respond";
import type { HelperAction } from "@/lib/host/helper";
import { getNumber } from "@/lib/settings";

export const dynamic = "force-dynamic";

const ACTIONS: Record<string, HelperAction> = {
  ps: "compose.ps",
  config: "compose.config",
  up: "compose.up",
  pull: "compose.pull",
  restart: "compose.restart",
  down: "compose.down",
};

/**
 * `docker compose` işlemleri.
 *
 * Panel bunu kendisi çalıştıramıyor: `docker compose` bir CLI eklentisi ve
 * container'da yok — host'taki helper'a rica ediliyor.
 *
 * `up` ve `down` uzun sürebiliyor ama SENKRON kalıyor: helper'ın kendi
 * `TIMEOUT_MS`'i (130 sn) zaten üst sınır ve tipik bir compose işlemi
 * saniyeler sürüyor. Asenkron modeli buraya da yaymak, sorunu olmayan bir uca
 * ikinci bir tur eklemek olurdu — `container update`teki dakikalar süren
 * imaj çekmeyle aynı sınıfta değil.
 */
export async function POST(request: Request) {
  const guard = await guardV1(request, "host.service");
  if (!guard.ok) return guard.response;

  const idem = beginIdempotent(request, guard.actor);
  if (idem.kind === "invalid") return idem.response;
  if (idem.kind === "replay") return idem.response;

  const body = await readJsonBody<{ action?: unknown; dir?: unknown }>(
    request,
    getNumber("api.max_body_bytes"),
  );
  if (!body.ok) return body.response;

  const requested = String(body.body.action ?? "");
  const action = ACTIONS[requested];
  if (!action) {
    return apiError(
      "invalid_request",
      serverT("api.v1.invalidValue", { field: serverT("api.v1.field.action"), values: Object.keys(ACTIONS).join(", ") }),
    );
  }

  const dir = String(body.body.dir ?? "");
  // Mutlak yol zorunlu — göreli bir yol helper'ın çalışma dizinine göre
  // çözülür ve o dizin panelin bildiği bir şey değil.
  if (!dir.startsWith("/")) {
    return apiError("invalid_request", serverT("api.v1.dirAbsolute"));
  }

  return runHelperAction({
    actor: guard.actor,
    action,
    args: { dir },
    idempotency: idem.context,
    auditAction: `host.compose_${requested}`,
    targetId: dir,
  });
}
