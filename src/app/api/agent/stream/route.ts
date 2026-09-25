import { handleStream } from "@/lib/agent/server";

export const dynamic = "force-dynamic";

/** panel-agent: imzalı akış (NDJSON) — image çekme, log takibi. */
export function POST(request: Request) {
  return handleStream(request);
}
