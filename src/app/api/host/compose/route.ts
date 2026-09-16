import { serverT } from "@/lib/i18n/runtime";
import { guardApi } from "@/lib/auth/api";
import { audit } from "@/lib/auth/audit";
import { callHelper, helperConfigured, type HelperAction } from "@/lib/host/helper";
import { getDockerProvider } from "@/lib/providers";

export const dynamic = "force-dynamic";

/**
 * Compose yığın yönetimi (M1.12).
 *
 * `docker compose` bir **CLI eklentisidir**; Docker Engine API'sinde karşılığı
 * yoktur. Yani panel container'ından çağrılamaz — compose dosyalarını görmesi
 * ve `docker` binary'sine erişmesi gerekirdi. Bu yüzden komut host-helper
 * üzerinden geçiyor (T4) ve hangi dizinlerde compose çalıştırılabileceğine
 * host'taki izin listesi karar veriyor.
 *
 * Yığınların nerede olduğu tahmin edilmiyor: çalışan container'ların
 * `com.docker.compose.project.working_dir` etiketinden okunuyor. Compose
 * dosyasının yerini kullanıcıya ayrı ayrı yazdırmak, iki kaynağın ayrışması
 * demekti.
 */

const ALLOWED: HelperAction[] = [
  "compose.ps",
  "compose.config",
  "compose.up",
  "compose.pull",
  "compose.restart",
  "compose.down",
];

type Stack = {
  project: string;
  workingDir: string | null;
  configFiles: string | null;
  services: { name: string; container: string; state: string; status: string }[];
};

/** Çalışan container'lardan compose yığınlarını türetir. */
async function discoverStacks(): Promise<Stack[]> {
  const raw = getDockerProvider();
  const containers = await raw.list(true);
  const byProject = new Map<string, Stack>();

  for (const container of containers) {
    if (!container.composeProject) continue;

    let stack = byProject.get(container.composeProject);
    if (!stack) {
      stack = {
        project: container.composeProject,
        workingDir: null,
        configFiles: null,
        services: [],
      };
      byProject.set(container.composeProject, stack);
    }

    stack.services.push({
      name: container.composeService ?? container.name,
      container: container.name,
      state: container.state,
      status: container.status,
    });
  }

  // Çalışma dizini yalnızca tam inspect'te var; proje başına bir container
  // yeterli, hepsini sorgulamanın anlamı yok.
  for (const stack of byProject.values()) {
    const first = stack.services[0];
    if (!first) continue;
    const detail = (await raw.inspectRaw(first.container)) as
      | { Config?: { Labels?: Record<string, string> } }
      | null;
    const labels = detail?.Config?.Labels ?? {};
    stack.workingDir = labels["com.docker.compose.project.working_dir"] ?? null;
    stack.configFiles = labels["com.docker.compose.project.config_files"] ?? null;
  }

  return [...byProject.values()].sort((a, b) => a.project.localeCompare(b.project, "tr"));
}

export async function GET(request: Request) {
  const guard = await guardApi(request, "docker.view");
  if (!guard.ok) return guard.response;

  try {
    return Response.json({
      stacks: await discoverStacks(),
      helperReady: helperConfigured(),
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : serverT("api.host.stacksUnreadable") },
      { status: 502 },
    );
  }
}

export async function POST(request: Request) {
  const guard = await guardApi(request, "host.service");
  if (!guard.ok) return guard.response;

  let body: { action?: unknown; dir?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: serverT("api.invalidRequest") }, { status: 400 });
  }

  const action = String(body.action ?? "") as HelperAction;
  const dir = String(body.dir ?? "");

  if (!ALLOWED.includes(action)) {
    return Response.json({ error: serverT("api.invalidAction") }, { status: 400 });
  }
  if (!dir.startsWith("/")) {
    return Response.json({ error: serverT("api.host.invalidStackDir") }, { status: 400 });
  }

  if (!helperConfigured()) {
    return Response.json(
      {
        error:
          serverT("api.host.helperMissingCompose"),
      },
      { status: 503 },
    );
  }

  const user = guard.session.user;
  const response = await callHelper(action, { dir }, {
    username: user.username,
    userId: user.id,
  });

  audit({
    userId: user.id,
    username: user.username,
    action: `host.${action}`,
    targetType: "compose",
    targetId: dir,
    detail: response.ok
      ? (response.stdout ?? "").slice(0, 300)
      : (response.error ?? response.stderr ?? "").slice(0, 300),
    result: response.ok ? "ok" : "error",
  });

  if (!response.ok) {
    return Response.json(
      { error: response.error ?? response.stderr ?? serverT("api.host.commandFailed") },
      { status: 502 },
    );
  }

  return Response.json({
    ok: true,
    // compose çıktısının çoğu stderr'a yazılır (ilerleme satırları); ikisini
    // birden döndürmek gerekiyor, yoksa başarılı bir `up` boş görünürdü.
    output: `${response.stdout ?? ""}${response.stderr ?? ""}`.trim(),
  });
}
