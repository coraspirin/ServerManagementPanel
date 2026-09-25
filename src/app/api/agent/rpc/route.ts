import { handleRpc } from "@/lib/agent/server";

export const dynamic = "force-dynamic";

/** panel-agent: imzalı tek seferlik işlem (yalnızca PANEL_ROLE=agent). */
export function POST(request: Request) {
  return handleRpc(request);
}
