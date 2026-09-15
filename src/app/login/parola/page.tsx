import { redirect } from "next/navigation";
import { currentSession } from "@/lib/auth/session";
import { PasswordForm } from "./PasswordForm";

export const dynamic = "force-dynamic";

export default async function ChangePasswordPage() {
  const session = await currentSession();
  if (!session) redirect("/login");

  return (
    <div className="flex min-h-dvh items-center justify-center bg-canvas p-4">
      <PasswordForm forced={session.user.mustChangePassword} />
    </div>
  );
}
