import { guardApi } from "@/lib/auth/api";
import { audit } from "@/lib/auth/audit";
import { createContainerFromSpec } from "@/lib/docker/create";
import { dockerOverview } from "@/lib/docker/view";
import { specProblem, type ContainerSpec } from "@/lib/docker/spec";
import { isMockMode } from "@/lib/env";

export const dynamic = "force-dynamic";

/**
 * Container oluştur (M3.46).
 *
 * `docker.action` izniyle korunuyor, ayrı bir `docker.create` izni
 * TANIMLANMADI: bu izne sahip olan zaten container silebiliyor ve web
 * terminali açabiliyor. Yeni bir izin anahtarı, gerçekte bir sınır
 * getirmeden rol ekranını kalabalıklaştırırdı.
 *
 * Yanıt güncel tabloyu taşıyor — panelin başka her eyleminde olduğu gibi,
 * istemci ayrıca bir liste isteği atmasın diye.
 */
export async function POST(request: Request) {
  const guard = await guardApi(request, "docker.action");
  if (!guard.ok) return guard.response;

  if (isMockMode()) {
    return Response.json(
      { error: "MOCK_MODE açıkken container oluşturulamaz — gerçek bir Docker gerekiyor." },
      { status: 503 },
    );
  }

  let spec: ContainerSpec;
  try {
    spec = (await request.json()) as ContainerSpec;
  } catch {
    return Response.json({ error: "Geçersiz istek gövdesi." }, { status: 400 });
  }

  // Aynı doğrulama istemcide de çalışıyor; buradaki kopya doğruluk için.
  const problem = specProblem(spec);
  if (problem) return Response.json({ error: problem }, { status: 400 });

  const user = guard.session.user;

  try {
    const result = await createContainerFromSpec(spec);

    audit({
      userId: user.id,
      username: user.username,
      action: "docker.create",
      targetType: "container",
      targetId: result.name,
      detail:
        `image ${spec.image}` +
        (result.started ? " · başlatıldı" : " · başlatılmadı") +
        (result.warnings.length > 0 ? ` · ${result.warnings.join(" · ")}` : ""),
      // Uyarı varsa işlem yarım kalmış demek; denetim kaydı bunu ayırabilmeli.
      result: result.warnings.length > 0 ? "error" : "ok",
    });

    return Response.json({ ...result, ...(await dockerOverview()) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Container oluşturulamadı.";

    audit({
      userId: user.id,
      username: user.username,
      action: "docker.create",
      targetType: "container",
      targetId: spec.name,
      detail: message,
      result: "error",
    });

    return Response.json({ error: message }, { status: 400 });
  }
}
