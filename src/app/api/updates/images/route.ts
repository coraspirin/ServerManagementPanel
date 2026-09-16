import { serverT } from "@/lib/i18n/runtime";
import { guardApi } from "@/lib/auth/api";
import { audit } from "@/lib/auth/audit";
import { cachedImageUpdates, refreshImageUpdates } from "@/lib/updates";

export const dynamic = "force-dynamic";

/** Son kontrol sonucu (M1.10). */
export async function GET(request: Request) {
  const guard = await guardApi(request, "docker.view");
  if (!guard.ok) return guard.response;

  const cached = cachedImageUpdates();
  return Response.json({
    updates: cached?.value ?? [],
    checkedAt: cached?.updatedAt ?? null,
  });
}

/**
 * "Şimdi kontrol et".
 *
 * Zamanlanmış işin aynısını elle çalıştırır. Kayıt defterine ağ isteği attığı
 * için yavaş olabilir; istemci bunu bekleyerek gösteriyor.
 */
export async function POST(request: Request) {
  const guard = await guardApi(request, "docker.action");
  if (!guard.ok) return guard.response;

  try {
    const updates = await refreshImageUpdates();
    const outdated = updates.filter((entry) => entry.updateAvailable === true).length;

    audit({
      userId: guard.session.user.id,
      username: guard.session.user.username,
      action: "updates.image_check",
      detail: serverT("api.updates.summary", { containers: updates.length, outdated }),
      result: "ok",
    });

    return Response.json({ updates, checkedAt: Math.floor(Date.now() / 1000) });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : serverT("api.updates.checkFailed") },
      { status: 502 },
    );
  }
}
