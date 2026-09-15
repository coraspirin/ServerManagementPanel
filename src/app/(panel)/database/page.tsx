import { requirePermission } from "@/lib/auth/guard";
import { hasPermission } from "@/lib/auth/session";
import { listConnections, listHistory, listSavedQueries } from "@/lib/dbadmin/store";
import { DatabaseScreen } from "./DatabaseScreen";

export const dynamic = "force-dynamic";

/** Veritabanı yöneticisi (M3.6). */
export default async function DatabasePage() {
  const session = await requirePermission("db.read");

  return (
    <DatabaseScreen
      initial={{
        connections: listConnections(),
        history: listHistory(session.user.id),
        saved: listSavedQueries(),
      }}
      canWrite={hasPermission(session.user, "db.write")}
    />
  );
}
