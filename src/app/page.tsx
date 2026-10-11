import { redirect } from "next/navigation";
import { currentSession } from "@/lib/auth/session";
import { needsSetup } from "@/lib/auth/setup";

export const dynamic = "force-dynamic";

/**
 * Kök adres — kendi içeriği yok, yalnızca yönlendirir.
 *
 * Henüz kullanıcı yoksa kurulum sihirbazına, oturum varsa ana sayfaya
 * (`/panel`; zorunlu parola değişimini panel düzeni kendisi yakalıyor),
 * yoksa girişe.
 *
 * ⚠️ Oturumsuz ziyaretçinin buraya ulaşabilmesi `middleware.ts`teki
 * `PUBLIC_EXACT` listesine bağlı: kök adres orada olmasaydı middleware
 * kurulum gerekip gerekmediğini bilmeden `/login`'e atardı.
 */
export default async function RootPage() {
  if (needsSetup()) redirect("/kurulum");
  redirect((await currentSession()) ? "/panel" : "/login");
}
