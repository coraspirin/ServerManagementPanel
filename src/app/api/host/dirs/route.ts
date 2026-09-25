import { enterHost, guardHostApi } from "@/lib/auth/api";
import { hostDirExists, listHostDirs } from "@/lib/host/dirs";

export const dynamic = "force-dynamic";

/**
 * Ayarlardaki dizin seçicinin veri kaynağı (M3.45).
 *
 * `settings.edit` ile korunuyor, `files.read` ile DEĞİL: bu uç dosya
 * yöneticisinin izinli kök listesini yapılandırmak için var ve o listeyle
 * sınırlanamaz (bkz. lib/host/dirs.ts). Yalnızca klasör ADLARI dönüyor.
 */
export async function GET(request: Request) {
  const guard = await guardHostApi(request, "settings.edit", { agent: true });
  if (!guard.ok) return guard.response;
  enterHost(guard.hostId);

  const url = new URL(request.url);
  const target = url.searchParams.get("path") ?? "/";

  if (url.searchParams.get("mode") === "exists") {
    return Response.json({ exists: await hostDirExists(target) });
  }

  return Response.json(await listHostDirs(target));
}
