import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { LoginForm } from "./LoginForm";
import { currentSession } from "@/lib/auth/session";
import { getT } from "@/lib/i18n/server";

export const dynamic = "force-dynamic";

/**
 * Giriş sayfası — yalnızca form.
 *
 * Kart listesi burada DEĞİL: `e1cd72f` ile giriş ekranının altına eklenmişti,
 * sonra kök adresteki karşılama sayfasına taşındı. Kartların oturumsuz
 * görünmesini sağlayan `publicAppGroups()` ve dar logo route'u aynen duruyor,
 * yalnızca çağıran sayfa değişti.
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const session = await currentSession();
  if (session) {
    redirect(session.user.mustChangePassword ? "/login/parola" : "/panel");
  }

  const { next } = await searchParams;
  const t = getT();

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-6 bg-canvas p-4">
      <LoginForm next={next} />

      {/* Buraya çoğunlukla karşılamadaki düğmeden gelinir; geri dönüş yolu
          olmazsa kullanıcı tarayıcının geri tuşuna mahkûm kalırdı. */}
      <Link
        href="/"
        className="flex items-center gap-1.5 text-sm text-subtle transition-colors hover:text-ink"
      >
        <ArrowLeft className="size-3.5" aria-hidden />
        {t("auth.login.backToApps")}
      </Link>
    </div>
  );
}
