import { enterHost } from "@/lib/hosts/context";
import { pageHostId } from "@/lib/hosts/request";
import { requirePermission } from "@/lib/auth/guard";
import { hasPermission } from "@/lib/auth/session";
import { listPatterns, searchLogs } from "@/lib/logs/store";
import { LogsScreen } from "./LogsScreen";

export const dynamic = "force-dynamic";

/** Merkezi log arama (M3.3) — geçmişe dönük, tam metin. */
export default async function LogsPage() {
  const session = await requirePermission("logs.view");
  enterHost(await pageHostId());

  return (
    <LogsScreen
      initial={{ ...searchLogs({ limit: 200 }), patterns: listPatterns() }}
      canManagePatterns={hasPermission(session.user, "settings.edit")}
    />
  );
}
