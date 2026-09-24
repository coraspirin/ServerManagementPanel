import { serverT } from "@/lib/i18n/runtime";
import { enterHost, guardHostApi } from "@/lib/auth/api";
import { impactOfStopping } from "@/lib/docker/graph";
import { getRunbook } from "@/lib/docker/runbooks";
import { getDockerProvider } from "@/lib/providers";

export const dynamic = "force-dynamic";

/**
 * Container detayı: yapılandırma + bağımlılıklar + runbook + ham inspect (M1.8).
 *
 * Hepsi tek uçta dönüyor; detay penceresi açılırken dört ayrı istek atmak
 * ekranı parça parça doldururdu.
 *
 * Bağımlılık çıkarımı TÜM container'ların detayını ister (durmuşlar dahil):
 * durmuş bir container da yeniden başlatıldığında etkilenecektir.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await guardHostApi(request, "docker.view");
  if (!guard.ok) return guard.response;
  enterHost(guard.hostId);

  const id = (await params).id;
  const provider = getDockerProvider();

  try {
    const detail = await provider.detail(id);
    if (!detail) return Response.json({ error: serverT("api.notFound.container") }, { status: 404 });

    const summaries = await provider.list(true);
    const others = await Promise.all(
      summaries.filter((item) => item.id !== detail.id).map((item) => provider.detail(item.id)),
    );

    const all = [detail, ...others.filter((item) => item !== null)];

    return Response.json({
      detail,
      impact: impactOfStopping(detail, all),
      runbook: getRunbook("container", detail.name),
      raw: await provider.inspectRaw(id),
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : serverT("api.docker.unreachable") },
      { status: 502 },
    );
  }
}
