import { enterHost, guardHostApi } from "@/lib/auth/api";
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
  let guard = await guardHostApi(request, "cron.manage");
  if (!guard.ok) {
    guard = await guardHostApi(request, "settings.edit");
    if (!guard.ok) return guard.response;
  }
  enterHost(guard.hostId);

  return Response.json(await hostAccounts());
}
