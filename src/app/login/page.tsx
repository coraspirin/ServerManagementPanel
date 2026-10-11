import { redirect } from "next/navigation";
import { LoginForm } from "./LoginForm";
import { currentSession } from "@/lib/auth/session";
import { needsSetup } from "@/lib/auth/setup";

export const dynamic = "force-dynamic";

/** Giriş sayfası — yalnızca form. */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  if (needsSetup()) redirect("/kurulum");

  const session = await currentSession();
  if (session) {
    redirect(session.user.mustChangePassword ? "/login/parola" : "/panel");
  }

  const { next } = await searchParams;

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-6 bg-canvas p-4">
      <LoginForm next={next} />
    </div>
  );
}
