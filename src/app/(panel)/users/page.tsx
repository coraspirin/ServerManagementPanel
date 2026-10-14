import { cookies } from "next/headers";
import { requirePermission } from "@/lib/auth/guard";
import { SESSION_COOKIE } from "@/lib/auth/types";
import { listPermissions, listRoles, listSessions, listUsers } from "@/lib/auth/users";
import { UsersScreen, type Tab } from "./UsersScreen";

const TABS: readonly Tab[] = ["users", "roles", "sessions"];

export const dynamic = "force-dynamic";

/** Kullanıcı, rol ve oturum yönetimi (M3.1). */
export default async function UsersPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; role?: string }>;
}) {
  const session = await requirePermission("users.manage");
  const query = await searchParams;
  const tab = TABS.find((key) => key === query.tab) ?? "users";
  const role = Number(query.role);
  const token = (await cookies()).get(SESSION_COOKIE)?.value ?? null;

  return (
    <UsersScreen
      currentUserId={session.user.id}
      initialTab={tab}
      focusRoleId={Number.isInteger(role) ? role : null}
      initial={{
        users: listUsers(),
        roles: listRoles(),
        permissions: listPermissions(),
        sessions: listSessions(token),
      }}
    />
  );
}
