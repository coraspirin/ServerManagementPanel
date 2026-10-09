import { redirect } from "next/navigation";
import { needsSetup } from "@/lib/auth/setup";
import { SetupForm } from "./SetupForm";

export const dynamic = "force-dynamic";

/**
 * İlk kurulum — yalnızca kullanıcı tablosu boşken açılır. Kurulum bittikten
 * sonra bu adres girişe düşer; sihirbaz ikinci bir yönetici açmak için
 * kullanılamaz (uç da 409 verir).
 */
export default function SetupPage() {
  if (!needsSetup()) redirect("/login");

  return (
    <div className="flex min-h-dvh items-center justify-center bg-canvas p-4">
      <SetupForm />
    </div>
  );
}
