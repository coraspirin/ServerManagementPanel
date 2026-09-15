import { guardApi } from "@/lib/auth/api";
import { hostAccounts } from "@/lib/host/users";

export const dynamic = "force-dynamic";

/**
 * Host kullanıcı ve grup listesi (M3.45).
 *
 * İki ekran kullanıyor: Host görevlerindeki "çalıştıran kullanıcı" ve
 * Ayarlar → Dosyalar altındaki "kurulan dosyaların sahibi". Bu yüzden izin
 * ikisinden BİRİ yeterli — `cron.manage` olan bir kullanıcıya `settings.edit`
 * vermek, sırf bir açılır liste dolsun diye yetki genişletmek olurdu.
 */
export async function GET(request: Request) {
  const guard = await guardApi(request, "cron.manage");
  if (!guard.ok) {
    const fallback = await guardApi(request, "settings.edit");
    if (!fallback.ok) return fallback.response;
  }

  return Response.json(await hostAccounts());
}
