import { handleEnroll } from "@/lib/agent/server";

export const dynamic = "force-dynamic";

/** panel-agent: kayıt el sıkışması (sertifika parmak izi kanıtı). */
export function POST(request: Request) {
  return handleEnroll(request);
}
