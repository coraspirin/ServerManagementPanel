import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth/guard";
import { settingGroups } from "@/settings.schema";

export const dynamic = "force-dynamic";

/**
 * `/settings`in kendi içeriği yok: ayarlar kategorilere bölündü ve her kategori
 * kendi sayfasında duruyor (`/settings/<kategori>`). Buraya gelen ilk kategoriye
 * yönlendirilir — menüdeki "Ayarlar" başlığına tıklamak boş bir sayfa açmasın.
 */
export default async function SettingsPage() {
  await requirePermission("settings.view");
  redirect(`/settings/${settingGroups[0].key}`);
}
