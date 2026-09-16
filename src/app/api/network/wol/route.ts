import { serverT } from "@/lib/i18n/runtime";
import { guardApi } from "@/lib/auth/api";
import { audit } from "@/lib/auth/audit";
import {
  checkAwake,
  deleteWolDevice,
  getWolDevice,
  saveWolDevice,
  sendWol,
  validateWol,
} from "@/lib/network/wol";
import { networkPayload } from "../route";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const guard = await guardApi(request, "network.manage");
  if (!guard.ok) return guard.response;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: serverT("api.invalidRequest") }, { status: 400 });
  }

  if (body.action === "wake") {
    const device = getWolDevice(Number(body.id ?? 0));
    if (!device) return Response.json({ error: serverT("api.notFound.device") }, { status: 404 });

    try {
      await sendWol(device);
    } catch (error) {
      return Response.json(
        { error: serverT("api.network.wolFailed", { error: error instanceof Error ? error.message : String(error) }) },
        { status: 502 },
      );
    }

    audit({
      userId: guard.session.user.id,
      username: guard.session.user.username,
      action: "wol.send",
      targetId: String(device.id),
      detail: `${device.name} (${device.mac})`,
      result: "ok",
    });

    // "Gönderildi" ile "uyandı" farklı şeyler ve mesaj bunu ayırt ediyor.
    // Doğrulama adresi yoksa ikinciyi hiç iddia etmiyoruz.
    const awake = await checkAwake(device);
    return Response.json({
      ok: true,
      message:
        awake === null
          ? serverT("api.network.wolSentUnverified")
          : awake
            ? serverT("api.network.wolAwake", { name: device.name })
            : serverT("api.network.wolNoReply", { name: device.name }),
      ...(await networkPayload()),
    });
  }

  const input = {
    name: String(body.name ?? ""),
    mac: String(body.mac ?? ""),
    broadcast: String(body.broadcast ?? ""),
    port: Number(body.port ?? 9),
    checkHost: String(body.checkHost ?? ""),
  };

  const problem = validateWol(input);
  if (problem) return Response.json({ error: problem }, { status: 400 });

  const id = body.id === undefined || body.id === null ? null : Number(body.id);
  const saved = saveWolDevice(id, input);

  audit({
    userId: guard.session.user.id,
    username: guard.session.user.username,
    action: id === null ? "wol.create" : "wol.update",
    targetId: String(saved),
    detail: `${input.name} (${input.mac})`,
    result: "ok",
  });

  return Response.json({ ok: true, id: saved, ...(await networkPayload()) });
}

export async function DELETE(request: Request) {
  const guard = await guardApi(request, "network.manage");
  if (!guard.ok) return guard.response;

  const id = Number(new URL(request.url).searchParams.get("id") ?? "0");
  const device = getWolDevice(id);
  if (!device) return Response.json({ error: serverT("api.notFound.device") }, { status: 404 });

  deleteWolDevice(id);

  audit({
    userId: guard.session.user.id,
    username: guard.session.user.username,
    action: "wol.delete",
    targetId: String(id),
    detail: device.name,
    result: "ok",
  });

  return Response.json({ ok: true, ...(await networkPayload()) });
}
