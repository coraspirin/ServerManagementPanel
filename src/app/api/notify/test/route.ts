import { guardApi } from "@/lib/auth/api";
import { audit } from "@/lib/auth/audit";
import { channelStatuses, sendTest } from "@/lib/notify";

export const dynamic = "force-dynamic";

/**
 * Deneme bildirimi (M1.3).
 *
 * Bildirim ayarlarının doğru olup olmadığı ancak gerçek bir arıza olduğunda
 * anlaşılırsa çok geçtir; kanal kurulur kurulmaz sınanabilmeli.
 */
export async function POST(request: Request) {
  const guard = await guardApi(request, "settings.edit");
  if (!guard.ok) return guard.response;

  let body: { channel?: unknown };
  try {
    body = (await request.json()) as { channel?: unknown };
  } catch {
    return Response.json({ error: "geçersiz istek" }, { status: 400 });
  }

  if (typeof body.channel !== "string") {
    return Response.json({ error: "kanal gerekli" }, { status: 400 });
  }

  const result = await sendTest(body.channel);

  audit({
    userId: guard.session.user.id,
    username: guard.session.user.username,
    action: "notify.test",
    targetId: body.channel,
    detail: result.ok ? "gönderildi" : (result.error ?? "hata"),
    result: result.ok ? "ok" : "error",
  });

  return Response.json({ ...result, channels: channelStatuses() });
}
