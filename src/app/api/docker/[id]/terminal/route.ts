import { serverT } from "@/lib/i18n/runtime";
import { enterHost, guardHostApi } from "@/lib/auth/api";
import { audit } from "@/lib/auth/audit";
import { startSession } from "@/lib/docker/exec";
import { getDockerProvider } from "@/lib/providers";
import { isMockMode } from "@/lib/env";
import { getHost } from "@/lib/hosts/store";

export const dynamic = "force-dynamic";

/** İstemciden kabul edilen kabuklar (M3.34). Dışındaki değer yok sayılıyor. */
const SHELLS = ["auto", "/bin/bash", "/bin/sh", "/bin/zsh", "/bin/ash"];

/** `docker exec -u` biçimi: ad, uid ya da uid:gid. */
const USER_RE = /^[a-z_][a-z0-9_-]{0,31}$|^[0-9]{1,10}(:[0-9]{1,10})?$/i;

/**
 * Terminal oturumu başlatır (M1.9).
 *
 * Container içinde kabuk açmak, o container'da genelde **root** olmak
 * demektir; bu yüzden ayrı bir izin (`docker.exec`) isteniyor ve her oturum
 * başlangıcı audit'e düşüyor. Oturumun kime ait olduğu bellekte tutuluyor:
 * oturum kimliğini ele geçiren başka bir kullanıcı da bağlanamaz.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await guardHostApi(request, "docker.exec", { agent: true });
  if (!guard.ok) return guard.response;
  enterHost(guard.hostId);

  // Mock modda sahte container'da kabuk yok; ama kayıtlı bir ajan sunucusu
  // gerçektir ve terminali de gerçektir.
  if (isMockMode() && getHost(guard.hostId)?.agentType !== "agent") {
    return Response.json(
      { error: serverT("api.mock.terminal") },
      { status: 503 },
    );
  }

  const id = (await params).id;

  let body: { cols?: unknown; rows?: unknown; shell?: unknown; user?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    body = {};
  }

  const cols = clamp(Number(body.cols ?? 80), 20, 500);
  const rows = clamp(Number(body.rows ?? 24), 5, 200);

  /*
    Kabuk ve kullanıcı seçimi (M3.34) BEYAZ LİSTEDEN geçiyor.

    İkisi de `docker exec`e komut ve `-u` olarak gidiyor; istemciden gelen ham
    dizeyi doğrudan geçirmek, bir kullanıcıya container içinde istediği
    ikiliyi çalıştırma imkânı vermek olurdu. `docker.exec` izni zaten kabuk
    açma izni ama izin listesi, izni OLMAYAN bir yoldan (ör. ileride eklenecek
    bir otomasyon ucundan) gelen isteklerde de dar kalmayı sağlıyor.
  */
  const shell = SHELLS.includes(String(body.shell ?? "")) ? String(body.shell) : "";
  const user = USER_RE.test(String(body.user ?? "")) ? String(body.user) : "";

  const state = await getDockerProvider().inspect(id);
  if (!state) return Response.json({ error: serverT("api.notFound.container") }, { status: 404 });
  if (!state.running) {
    return Response.json(
      { error: serverT("api.docker.notRunning") },
      { status: 409 },
    );
  }

  try {
    const session = await startSession({
      containerId: id,
      containerName: state.name,
      username: guard.session.user.username,
      cols,
      rows,
      shell,
      user,
    });

    audit({
      userId: guard.session.user.id,
      username: guard.session.user.username,
      action: "docker.exec",
      targetType: "container",
      targetId: state.name,
      detail:
        serverT("api.docker.terminalOpened", { cols, rows }) +
        (shell ? ` · ${serverT("api.docker.shell", { shell })}` : "") +
        (user ? ` · ${serverT("api.docker.user", { user })}` : ""),
      result: "ok",
    });

    return Response.json({ sessionId: session.id, container: state.name });
  } catch (error) {
    const message = error instanceof Error ? error.message : serverT("api.docker.terminalFailed");
    audit({
      userId: guard.session.user.id,
      username: guard.session.user.username,
      action: "docker.exec",
      targetType: "container",
      targetId: state.name,
      detail: message,
      result: "error",
    });
    return Response.json({ error: message }, { status: 500 });
  }
}

function clamp(value: number, min: number, max: number): number {
  return Number.isFinite(value) ? Math.min(Math.max(Math.round(value), min), max) : min;
}
