import { handleAnnounce } from "@/lib/hosts/announce";

export const dynamic = "force-dynamic";

/** Native ajanın kendini duyurması (yalnız merkezde; bkz. hosts/announce.ts). */
export function POST(request: Request) {
  return handleAnnounce(request);
}
