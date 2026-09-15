import { guardApi } from "@/lib/auth/api";
import { audit } from "@/lib/auth/audit";
import { runCleanup, scanCleanup } from "@/lib/files/cleanup";

export const dynamic = "force-dynamic";

/** Disk temizlik asistanı (M3.5). Tarama okuma, temizlik yazma yetkisi ister. */
export async function GET(request: Request) {
  const guard = await guardApi(request, "files.read");
  if (!guard.ok) return guard.response;

  return Response.json(await scanCleanup());
}

export async function POST(request: Request) {
  const guard = await guardApi(request, "files.write");
  if (!guard.ok) return guard.response;

  let body: { id?: unknown };
  try {
    body = (await request.json()) as { id?: unknown };
  } catch {
    return Response.json({ error: "geçersiz istek" }, { status: 400 });
  }

  const id = String(body.id ?? "");
  const result = await runCleanup(id);

  audit({
    userId: guard.session.user.id,
    username: guard.session.user.username,
    action: "files.cleanup",
    targetType: "cleanup",
    targetId: id,
    detail: `${result.message} (${result.reclaimedBytes} bayt)`,
    result: result.ok ? "ok" : "error",
  });

  return Response.json({ ...result, ...(await scanCleanup()) });
}
