import { guardApi } from "@/lib/auth/api";
import { serverT } from "@/lib/i18n/runtime";
import { audit } from "@/lib/auth/audit";
import { installComposeStack } from "@/lib/appstore/install";
import { generateCompose, type EnvMode } from "@/lib/compose/generate";
import { checkCompose, EMPTY_CONTEXT } from "@/lib/compose/checks";
import { parseCompose } from "@/lib/compose/service";
import { getDockerProvider } from "@/lib/providers";

export const dynamic = "force-dynamic";

/**
 * Container'dan compose üretme ucu (M3.31).
 *
 * ## İzin ayrımı
 *
 * ÜRETME (`GET`) `docker.view`: çıktı, kullanıcının inspect sekmesinde zaten
 * görebildiği verinin daha okunur bir hâli — yeni bir yetki vermiyor.
 *
 * KAYDETME (`POST`) `apps.install`: diske dosya yazıp `compose up` çalıştırıyor,
 * yani yeni container ayağa kaldırıyor. Bu, appstore kurulumuyla birebir aynı
 * yetenek ve aynı izne bağlanması gerekiyor — ayrı bir izne bağlamak, aynı işi
 * yapan iki kapıdan birini zayıf bırakmak olurdu.
 */

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await guardApi(request, "docker.view");
  if (!guard.ok) return guard.response;

  const id = (await params).id;
  const url = new URL(request.url);
  const env: EnvMode = url.searchParams.get("env") === "all" ? "all" : "user";

  const provider = getDockerProvider();

  let raw: unknown;
  try {
    raw = await provider.inspectRaw(id);
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : serverT("api.docker.containerUnreadable") },
      { status: 500 },
    );
  }

  if (!raw) return Response.json({ error: serverT("api.notFound.container") }, { status: 404 });

  /*
    İmajın yapılandırması gürültü ayıklamanın ÖN KOŞULU: hangi env ve komutun
    imajdan geldiğini ancak imaja bakarak bilebiliyoruz. Okunamazsa üretim
    yine de yapılıyor — eksik ama çalışan bir dosya, hiç dosya olmamasından
    iyi — ve durum uyarı olarak dönüyor.
  */
  const imageId = (raw as { Image?: string }).Image ?? "";
  const image = imageId ? await provider.inspectImageRaw(imageId).catch(() => null) : null;

  const result = generateCompose(raw, image, { env });

  /*
    Üretilen dosya kendi ön kontrolümüzden geçiriliyor. Panelin ürettiği bir
    dosyayı denetlemeden vermek, "sürüm etiketi sabitlenmemiş" gibi bir bulguyu
    kullanıcı `up` dedikten sonra keşfetmesine bırakmak olurdu.

    Bağlam BOŞ veriliyor: dolu port ve ağ kontrolleri burada yanlış pozitif
    üretir — container ZATEN çalışıyor, portları da ağları da doğal olarak
    kendisi tutuyor.
  */
  const { doc } = parseCompose(result.yaml);
  const findings = doc
    ? checkCompose(doc, { ...EMPTY_CONTEXT, source: result.yaml }, serverT)
    : [];

  return Response.json({ ...result, findings });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await guardApi(request, "apps.install");
  if (!guard.ok) return guard.response;

  const id = (await params).id;
  const body = (await request.json().catch(() => ({}))) as { name?: unknown; compose?: unknown };

  const actor = { username: guard.session.user.username, userId: guard.session.user.id };
  const outcome = await installComposeStack(
    { name: String(body.name ?? ""), compose: String(body.compose ?? "") },
    actor,
  );

  audit({
    userId: actor.userId,
    username: actor.username,
    action: "docker.compose_generate",
    targetType: "container",
    targetId: id,
    detail: serverT("api.docker.stackDetail", { name: String(body.name ?? ""), message: outcome.message }),
    result: outcome.ok ? "ok" : "error",
  });

  return Response.json(
    outcome.ok
      ? { ok: true, message: outcome.message, output: outcome.output }
      : { ok: false, error: outcome.message },
    { status: outcome.ok ? 200 : 400 },
  );
}
