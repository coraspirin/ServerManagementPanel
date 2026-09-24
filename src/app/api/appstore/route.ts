import { serverT } from "@/lib/i18n/runtime";
import { enterHost, guardHostApi } from "@/lib/auth/api";
import {
  installComposeStack,
  listStacks,
  removeStack,
  stackAction,
  stacksRoot,
  type StackAction,
} from "@/lib/appstore/install";
import { composePreflight } from "@/lib/appstore/preflight";
import { applyFix, checkCompose } from "@/lib/compose/checks";
import { parseCompose, readAllServices, stringifyCompose } from "@/lib/compose/service";
import { getDockerProvider } from "@/lib/providers";
import { panelPorts } from "@/lib/security/firewall";
import { cachedPortScan } from "@/lib/security/ports";

export const dynamic = "force-dynamic";

const ACTIONS = new Set<StackAction>(["up", "down", "restart", "pull"]);

export async function GET(request: Request) {
  const guard = await guardHostApi(request, "apps.install");
  if (!guard.ok) return guard.response;
  enterHost(guard.hostId);

  const user = guard.session.user;

  return Response.json({
    stacks: listStacks(),
    stacksRoot: stacksRoot(),
    // Kurulum çalışacak mı — kullanıcı dosyayı seçmeden ÖNCE.
    preflight: await composePreflight({ username: user.username, userId: user.id }),
  });
}

export async function POST(request: Request) {
  const guard = await guardHostApi(request, "apps.install");
  if (!guard.ok) return guard.response;
  enterHost(guard.hostId);

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: serverT("api.invalidRequest") }, { status: 400 });
  }

  const actor = { username: guard.session.user.username, userId: guard.session.user.id };
  const action = String(body.action ?? "install");

  const state = () => ({ stacks: listStacks(), stacksRoot: stacksRoot() });

  /**
   * Kurulum öncesi ön kontrol (M3.19).
   *
   * YAML burada YAZILMIYOR, yalnızca okunuyor: kullanıcı kurmadan önce neyin
   * patlayacağını görsün. `fixes` verilirse düzeltilmiş metin geri döner —
   * dosyaya değil, hâlâ ekrandaki kutuya.
   */
  if (action === "check") {
    const { doc, error } = parseCompose(String(body.compose ?? ""));
    if (!doc) {
      return Response.json({
        ok: false,
        error: serverT("api.compose.yamlError", { error: String(error) }),
        findings: [],
        services: [],
      });
    }

    for (const fix of (body.fixes ?? []) as { service?: unknown; kind?: unknown }[]) {
      applyFix(doc, String(fix.service ?? ""), fix.kind === "logging" ? "logging" : "restart");
    }

    const scan = cachedPortScan();

    // Burada hariç tutma YOK ve olmamalı: kurulacak yığın henüz mevcut değil,
    // dolayısıyla hiçbir port ona ait olamaz. Düzenleme akışındaki proje bazlı
    // hariç tutma (M3.26) yalnızca var olan bir yığın için anlamlı.
    const reserved = new Map<number, string>();
    for (const port of scan.ports) {
      const owner = port.owner.name || port.process;
      if (owner && !reserved.has(port.port)) reserved.set(port.port, owner);
    }

    const reservedAgeSeconds =
      scan.updatedAt === null
        ? null
        : Math.max(0, Math.floor(Date.now() / 1000) - scan.updatedAt);

    // `networks` null kalırsa dış ağ kontrolü ATLANIR. Boş dizi bırakmak
    // "Docker'da hiç ağ yok" demek olur ve external işaretli her ağ için
    // sahte bir engel üretirdi (bkz. CheckContext.networks).
    let networks: string[] | null = null;
    let containerNames: string[] = [];
    try {
      const provider = getDockerProvider();
      networks = (await provider.networks()).map((entry) => entry.name);
      containerNames = (await provider.list(true)).map((entry) => entry.name);
    } catch {
      // Docker okunamazsa bu iki kontrol atlanır; geri kalanı yine çalışır.
    }

    return Response.json({
      ok: true,
      findings: checkCompose(doc, {
        source: String(body.compose ?? ""),
        reserved,
        reservedAgeSeconds,
        panelPorts: panelPorts(),
        networks,
        containerNames,
      }, serverT),
      services: readAllServices(doc),
      compose: stringifyCompose(doc),
    });
  }

  if (action === "install") {
    const outcome = await installComposeStack(
      { name: String(body.name ?? ""), compose: String(body.compose ?? "") },
      actor,
    );
    return Response.json(
      outcome.ok
        ? { ...state(), ok: true, message: outcome.message, output: outcome.output }
        : { ...state(), ok: false, error: outcome.message },
      { status: outcome.ok ? 200 : 400 },
    );
  }

  if (action === "remove") {
    const outcome = await removeStack(String(body.name ?? ""), actor);
    return Response.json(
      { ...state(), ok: outcome.ok, message: outcome.message },
      { status: outcome.ok ? 200 : 400 },
    );
  }

  if (ACTIONS.has(action as StackAction)) {
    const outcome = await stackAction(String(body.name ?? ""), action as StackAction, actor);
    return Response.json(
      outcome.ok
        ? { ...state(), ok: true, message: outcome.message }
        : { ...state(), ok: false, error: outcome.message },
      { status: outcome.ok ? 200 : 400 },
    );
  }

  return Response.json({ error: serverT("api.unknownAction") }, { status: 400 });
}
