import { serverT } from "@/lib/i18n/runtime";
import { enterHost, guardHostApi } from "@/lib/auth/api";
import { runWithHost } from "@/lib/hosts/context";
import { applyFix, checkCompose, type Finding } from "@/lib/compose/checks";
import {
  applyComposeEdit,
  listComposeBackups,
  readComposeFile,
  restoreComposeBackup,
} from "@/lib/compose/edit";
import { isLocated, locateCompose, type ComposeLocation } from "@/lib/compose/locate";
import { parsePortSpec, type PortSpec } from "@/lib/compose/ports";
import {
  networkMode,
  parseCompose,
  readService,
  setServiceEnvironment,
  setServiceNetworks,
  setServicePorts,
  setServiceRestart,
  stringifyCompose,
  type ServiceConfig,
} from "@/lib/compose/service";
import { getDockerProvider } from "@/lib/providers";
import { panelPorts } from "@/lib/security/firewall";
import { cachedPortScan } from "@/lib/security/ports";
import { dockerPublishedPorts, reservedByOthers } from "@/lib/security/portmap";

export const dynamic = "force-dynamic";

/**
 * Container'ın compose ayarlarını okuma ve düzenleme (M3.19).
 *
 * ⚠️ CONTAINER DEĞİL, COMPOSE DOSYASI DÜZENLENİYOR. M1.8'de env/port
 * düzenlemesinin Docker API'siyle yapılması bilerek reddedilmişti: compose ile
 * yönetilen bir container'da böyle bir değişiklik ilk `compose up`'ta geri
 * alınır. Doğru yer olarak M1.12 (compose yönetimi) işaretlenmişti; burası o
 * boşluğun doldurulduğu yer.
 *
 * Dosya yolu istemciden ALINMIYOR: container'ın Docker etiketlerinden
 * çözülüyor (`locate.ts`). Böylece panel, gerçekten çalışan bir compose
 * projesinin kendi bildirdiği dosyası dışında hiçbir yere yazamıyor.
 */

/** Okuma `security.view` değil `docker.view` istiyor — bu bir Docker ekranı. */
async function locate(request: Request, id: string, permission: "docker.view" | "docker.action") {
  const guard = await guardHostApi(request, permission);
  if (!guard.ok) return { response: guard.response } as const;

  // Bağlam burada kurulamaz (çağırana geçmez); çağıran `enterHost` ile kurar.
  const location = await runWithHost(guard.hostId, () => locateCompose(id));
  if (!isLocated(location)) {
    return { response: Response.json({ error: location.error }, { status: 409 }) } as const;
  }

  return { guard, location } as const;
}

/**
 * Ön kontrol bağlamı: port haritası önbelleği (M3.17) + Docker'ın gerçek ağ
 * listesi.
 *
 * `networks` M3.19'da boş dizi olarak bırakılmıştı ve bu, `external: true`
 * işaretli her ağ için SAHTE bir "dış ağ bulunamadı" engeli üretiyordu. Artık
 * Docker'a gerçekten soruluyor; sorulamadığında `null` bırakılıyor ve kontrol
 * atlanıyor (bkz. `CheckContext.networks`).
 *
 * Dolu port hariç tutması `reservedByOthers` ile PROJE bazında yapılıyor.
 * Burada eskiden `owner === location.service` karşılaştırması vardı; sahip
 * container adı (`passbolt-passbolt-1`), karşılaştırılan ise compose servis
 * adıydı (`passbolt`) — hiç eşleşmiyordu ve her container kendi portunu
 * "başkası tutuyor" sanıyordu (M3.26).
 *
 * `containerNames` bilerek boş: düzenlenen container'ın `container_name`'i
 * zaten çalışıyor, listeyi doldurmak her servisi kendisiyle çakıştırırdı.
 */
async function checkContext(location: ComposeLocation, containerId: string) {
  const scan = cachedPortScan();
  const published = dockerPublishedPorts(scan.containers);

  const reserved = reservedByOthers(scan.ports, scan.containers, {
    project: location.project,
    container: containerId,
  });

  // Taramanın yaşı bulgunun ŞİDDETİNİ belirliyor: bayat veriyle engellemek yok.
  const reservedAgeSeconds =
    scan.updatedAt === null ? null : Math.max(0, Math.floor(Date.now() / 1000) - scan.updatedAt);

  let networks: { name: string; driver: string; composeProject: string | null }[] | null = null;
  try {
    networks = (await getDockerProvider().networks())
      .filter((entry) => !entry.builtin)
      .map((entry) => ({
        name: entry.name,
        driver: entry.driver,
        composeProject: entry.composeProject,
      }));
  } catch {
    // Docker okunamadı: ağ kontrolü atlanır, geri kalan kontroller çalışır.
  }

  return {
    reserved,
    reservedAgeSeconds,
    panelPorts: panelPorts(),
    networks: networks === null ? null : networks.map((entry) => entry.name),
    containerNames: [] as string[],
    published: [...published],
    availableNetworks: networks ?? [],
  };
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = (await params).id;
  const found = await locate(request, id, "docker.view");
  if ("response" in found) return found.response;
  enterHost(found.guard.hostId);

  const { location } = found;
  const file = await readComposeFile(location);
  if (file.error !== null) return Response.json({ error: file.error }, { status: 502 });

  const { doc, error } = parseCompose(file.text);
  if (!doc) return Response.json({ error: `${location.file}: ${error}` }, { status: 422 });

  const service = readService(doc, location.service);
  if (!service) {
    return Response.json(
      {
        error:
          serverT("api.docker.serviceMissing", { service: location.service, file: location.file }),
      },
      { status: 409 },
    );
  }

  const [context, backups] = await Promise.all([
    checkContext(location, id),
    listComposeBackups(location),
  ]);

  return Response.json({
    location,
    service,
    // `source`: bulgulara satır numarası yazılabilmesi için ham metin (M3.34).
    findings: checkCompose(doc, { ...context, source: file.text }, serverT),
    dockerPublished: context.published,
    availableNetworks: context.availableNetworks,
    networkMode: networkMode(doc, location.service),
    backups,
    text: file.text,
  });
}

type EditBody = {
  ports?: PortSpec[];
  networks?: string[];
  environment?: { key: string; value: string }[];
  restart?: string;
  fixes?: { service: string; kind: "restart" | "logging" }[];
  /** true ise dosya yazılmaz, yalnızca yeni metin döner (diff önizleme). */
  preview?: boolean;
  /** false ise dosya yazılır ama `compose up` çağrılmaz. */
  restartStack?: boolean;
  /** "restore" ise düzenleme değil, `backup` adlı yedeğe dönüş yapılır. */
  action?: string;
  backup?: string;
};

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = (await params).id;
  const found = await locate(request, id, "docker.action");
  if ("response" in found) return found.response;
  enterHost(found.guard.hostId);

  const { guard, location } = found;

  let body: EditBody;
  try {
    body = (await request.json()) as EditBody;
  } catch {
    return Response.json({ error: serverT("api.invalidRequest") }, { status: 400 });
  }

  const actor = { username: guard.session.user.username, userId: guard.session.user.id };

  // Yedeğe dönüş, düzenleme akışının dışında: dosya okunmuyor, ayrıştırılmıyor,
  // yalnızca adı doğrulanmış bir yedek yerine kopyalanıp yığın başlatılıyor.
  if (body.action === "restore") {
    const outcome = await restoreComposeBackup(location, String(body.backup ?? ""), actor);
    return Response.json(outcome, { status: outcome.ok ? 200 : 400 });
  }

  const file = await readComposeFile(location);
  if (file.error !== null) return Response.json({ error: file.error }, { status: 502 });

  const { doc, error } = parseCompose(file.text);
  if (!doc) return Response.json({ error: `${location.file}: ${error}` }, { status: 422 });

  let updated: ServiceConfig | null;
  try {
    if (Array.isArray(body.ports)) {
      setServicePorts(doc, location.service, body.ports.map(normalizePort));
    }
    if (Array.isArray(body.networks)) {
      setServiceNetworks(doc, location.service, body.networks.map(String));
    }
    if (Array.isArray(body.environment)) {
      setServiceEnvironment(
        doc,
        location.service,
        body.environment.map((entry) => ({
          key: String(entry?.key ?? ""),
          value: String(entry?.value ?? ""),
        })),
      );
    }
    if (typeof body.restart === "string") {
      setServiceRestart(doc, location.service, body.restart);
    }
    for (const fix of body.fixes ?? []) {
      applyFix(doc, String(fix.service), fix.kind === "logging" ? "logging" : "restart");
    }
    updated = readService(doc, location.service);
  } catch (mutationError) {
    return Response.json(
      { error: mutationError instanceof Error ? mutationError.message : serverT("api.docker.editFailed") },
      { status: 400 },
    );
  }

  const text = stringifyCompose(doc);
  const findings: Finding[] = checkCompose(doc, {
    ...(await checkContext(location, id)),
    // Satır numaraları DÜZENLENMİŞ metne göre: kullanıcı önizlemede
    // gördüğü dosyada o satırı arayacak, eski dosyada değil.
    source: text,
  }, serverT);

  // Önizleme: hiçbir şey yazılmıyor, kullanıcı diff'i görüp onaylıyor.
  if (body.preview) {
    return Response.json({ preview: true, text, before: file.text, service: updated, findings });
  }

  const outcome = await applyComposeEdit(location, text, actor, {
    restart: body.restartStack !== false,
  });

  return Response.json(
    { ...outcome, service: updated, findings },
    { status: outcome.ok ? 200 : 400 },
  );
}

/**
 * İstemciden gelen port nesnesini güvenli hâle getirir.
 *
 * İstemci `PortSpec` gönderiyor ama ona güvenilmiyor: alanlar yeniden
 * ayrıştırılıyor, böylece uydurulmuş bir `raw` ile dosyaya keyfi metin
 * yazılamıyor.
 */
function normalizePort(input: PortSpec): PortSpec {
  if (input && typeof input === "object" && typeof input.raw === "string") {
    return parsePortSpec(input.raw);
  }

  const target = Number(input?.target ?? 0);
  const published = input?.published === null ? null : Number(input?.published ?? 0);
  const protocol = input?.protocol === "udp" ? "udp" : "tcp";
  const hostIp = typeof input?.hostIp === "string" ? input.hostIp : "";
  const form = input?.form === "long" ? "long" : "short";

  return { target, published, protocol, hostIp, form, raw: null };
}
