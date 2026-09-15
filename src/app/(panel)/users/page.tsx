import { cookies } from "next/headers";
import { requirePermission } from "@/lib/auth/guard";
import { SESSION_COOKIE } from "@/lib/auth/types";
import { listPermissions, listRoles, listSessions, listUsers } from "@/lib/auth/users";
import { UsersScreen } from "./UsersScreen";

export const dynamic = "force-dynamic";

/** Kullanıcı, rol ve oturum yönetimi (M3.1). */
export default async function UsersPage() {
  const session = await requirePermission("users.manage");
  const token = (await cookies()).get(SESSION_COOKIE)?.value ?? null;

  return (
    <UsersScreen
      currentUserId={session.user.id}
      initial={{
        users: listUsers(),
        roles: listRoles(),
        permissions: listPermissions(),
        sessions: listSessions(token),
      }}
    />
  );
}
