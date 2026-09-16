import { serverT } from "@/lib/i18n/runtime";
import { guardApi } from "@/lib/auth/api";
import { audit } from "@/lib/auth/audit";
import { unusedResources } from "@/lib/docker/graph";
import {
  cloneVolume,
  createVolume,
  exportVolume,
  listVolumePath,
  readVolumeFile,
} from "@/lib/docker/volumes";
import { exportImage, tagImage, untagImage } from "@/lib/docker/images";
import { getDockerProvider } from "@/lib/providers";
import type { ResourceKind } from "@/lib/providers/types";

export const dynamic = "force-dynamic";

const KINDS: ResourceKind[] = ["image", "volume", "network"];

async function collect() {
  const provider = getDockerProvider();
  const [images, volumes, networks] = await Promise.all([
    provider.images(),
    provider.volumes(),
    provider.networks(),
  ]);

  return { images, volumes, networks, unused: unusedResources(images, volumes, networks) };
}

/** Image / volume / ağ listesi + kullanılmayan kaynak raporu (M1.8). */
export async function GET(request: Request) {
  const guard = await guardApi(request, "docker.view");
  if (!guard.ok) return guard.response;

  const params = new URL(request.url).searchParams;
  const detail = params.get("detail");
  const id = params.get("id") ?? "";

  try {
    // Tekil kaynak detayı (M3.24) — liste yükünü büyütmemek için ayrı istek.
    if (detail === "image") {
      const provider = getDockerProvider();
      const [layers, raw] = await Promise.all([
        provider.imageHistory(id),
        provider.inspectImageRaw(id),
      ]);
      if (raw === null) return Response.json({ error: serverT("api.notFound.image") }, { status: 404 });
      return Response.json({ layers, raw });
    }

    /*
      Volume kök dizini (M3.40). `docker.view` yeterli: listeleme, kullanıcının
      volume detayında zaten gördüğü bilginin bir adım ötesi ve dosya İÇERİĞİ
      okunmuyor.
    */
    if (detail === "volume-files") {
      const result = await listVolumePath(id, params.get("path") ?? "/");
      return Response.json(result, { status: result.ok ? 200 : 400 });
    }

    /*
      Volume içindeki tek dosyayı indirme (M3.44). `docker.view` yeterli
      DEĞİL — dosya İÇERİĞİ okunuyor ve bir volume'ün içinde parola, anahtar
      ya da veritabanı olabilir. Listeleme görüntüleme izniyle, okuma
      `docker.action` ile.
    */
    if (detail === "volume-file") {
      const izin = await guardApi(request, "docker.action");
      if (!izin.ok) return izin.response;

      const result = await readVolumeFile(id, params.get("path") ?? "");
      if (!result.ok) return Response.json({ error: result.message }, { status: 400 });

      audit({
        userId: izin.session.user.id,
        username: izin.session.user.username,
        action: "docker.read_volume_file",
        targetType: "volume",
        targetId: id,
        detail: params.get("path") ?? "",
        result: "ok",
      });

      return new Response(new Uint8Array(result.bytes), {
        headers: {
          "content-type": "application/octet-stream",
          "content-disposition": `attachment; filename="${result.filename}"`,
          "content-length": String(result.bytes.length),
        },
      });
    }

    if (detail === "volume") {
      const raw = await getDockerProvider().inspectVolumeRaw(id);
      if (raw === null) return Response.json({ error: serverT("api.notFound.volume") }, { status: 404 });
      return Response.json({ raw });
    }

    /*
      Volume dışa aktarma (M3.33) GET'te: tarayıcının indirme akışına bir
      `<a href>` ile bağlanabilmesi gerekiyor ve POST bir dosya indirmesini
      tetikleyemiyor. İzin yine `docker.action` — arşiv volume'deki HER ŞEYİ
      taşıyor ve bu, salt-okur bir kullanıcıya verilecek bir yetenek değil.
    */
    /*
      Image dışa aktarma (M3.39) — volume dışa aktarmayla aynı gerekçeyle
      GET'te: tarayıcının indirme akışına bir `<a href>` ile bağlanmak
      gerekiyor ve POST bir indirmeyi tetikleyemiyor.
    */
    if (detail === "export-image") {
      const izin = await guardApi(request, "docker.action");
      if (!izin.ok) return izin.response;

      // Boyut sınırı için imajın kendi boyutu gerekiyor; liste zaten elde.
      const images = await getDockerProvider().images();
      const image = images.find((entry) => entry.id === id || entry.tags.includes(id));
      if (!image) return Response.json({ error: serverT("api.notFound.image") }, { status: 404 });

      const ad = (image.tags[0] ?? image.id.replace(/^sha256:/, "").slice(0, 12))
        .replace(/[^a-zA-Z0-9._-]+/g, "-")
        .replace(/^-+|-+$/g, "");

      const result = await exportImage(image.id, image.sizeBytes, `${ad}.tar`, {
        username: izin.session.user.username,
        userId: izin.session.user.id,
      });

      if (!result.ok) return Response.json({ error: result.message }, { status: 400 });

      return new Response(new Uint8Array(result.archive), {
        headers: {
          "content-type": "application/x-tar",
          "content-disposition": `attachment; filename="${result.filename}"`,
          "content-length": String(result.archive.length),
        },
      });
    }

    if (detail === "export") {
      const izin = await guardApi(request, "docker.action");
      if (!izin.ok) return izin.response;

      const result = await exportVolume(id, {
        username: izin.session.user.username,
        userId: izin.session.user.id,
      });

      if (!result.ok) return Response.json({ error: result.message }, { status: 400 });

      return new Response(new Uint8Array(result.archive), {
        headers: {
          "content-type": "application/x-tar",
          "content-disposition": `attachment; filename="${result.filename}"`,
          "content-length": String(result.archive.length),
        },
      });
    }

    // Volume boyutları PAHALI (Docker her volume'ü yürüyerek ölçüyor); bu
    // yüzden ayrı ve yalnızca kullanıcı isteyince.
    if (detail === "sizes") {
      return Response.json(await getDockerProvider().diskUsage());
    }

    return Response.json(await collect());
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : serverT("api.docker.unreachable") },
      { status: 502 },
    );
  }
}

/**
 * Tekil kaynak silme.
 *
 * Prune'dan (M1.7) ayrı duruyor: prune "kullanılmayan her şeyi" siler, bu ise
 * kullanıcının tek tek seçtiğini. Volume silmek VERİ SİLER; onay istemciden
 * alınır ama silinen şey her koşulda audit'e yazılır.
 */
export async function POST(request: Request) {
  const guard = await guardApi(request, "docker.action");
  if (!guard.ok) return guard.response;

  let body: {
    kind?: unknown;
    id?: unknown;
    force?: unknown;
    action?: unknown;
    target?: unknown;
    reference?: unknown;
    container?: unknown;
    spec?: unknown;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: serverT("api.invalidRequest") }, { status: 400 });
  }

  /*
    Volume klonlama (M3.33) aynı POST ucunda ama silme yolundan ÖNCE
    ayrılıyor: `kind`/`id` şeması silmeye ait ve klonlamanın ikinci bir adı
    (hedef) var. Ayrı bir route dosyası açmak, aynı kaynağın işlemlerini iki
    yere bölmek olurdu.
  */
  const actor = { username: guard.session.user.username, userId: guard.session.user.id };

  if (
    body.action === "network-create" ||
    body.action === "network-connect" ||
    body.action === "network-disconnect"
  ) {
    const provider = getDockerProvider();
    const id = typeof body.id === "string" ? body.id : "";
    const container = typeof body.container === "string" ? body.container : "";

    try {
      if (body.action === "network-create") {
        const spec = (body.spec ?? {}) as Record<string, unknown>;
        const name = String(spec.name ?? "").trim();

        /*
          Ad SUNUCUDA da doğrulanıyor. İstemcide de doğrulanıyor ama bu uç
          API token'ıyla da çağrılabiliyor; istemciye güvenmek denetimi
          tamamen kaldırmak olurdu.
        */
        if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,62}$/.test(name)) {
          return Response.json({ error: serverT("api.docker.networkName") }, { status: 400 });
        }

        /*
          Sürücü de beyaz listeden geçiyor. Arayüz zaten yalnızca desteklenen
          ikisini sunuyor ama bu uç API token'ıyla da çağrılabiliyor ve
          `macvlan` parent olmadan SESSİZCE bozuk bir ağ üretiyor — Docker hata
          vermediği için tek savunma burası.
        */
        const driver = String(spec.driver ?? "bridge");
        if (!["bridge", "overlay"].includes(driver)) {
          return Response.json(
            {
              error:
                serverT("api.docker.driverUnsupported", { driver }),
            },
            { status: 400 },
          );
        }

        await provider.createNetwork({
          name,
          driver,
          internal: spec.internal === true,
          attachable: spec.attachable === true,
          labels:
            spec.labels && typeof spec.labels === "object"
              ? (spec.labels as Record<string, string>)
              : {},
          subnet: String(spec.subnet ?? "").trim(),
          gateway: String(spec.gateway ?? "").trim(),
          ipRange: String(spec.ipRange ?? "").trim(),
        });
      } else if (body.action === "network-connect") {
        await provider.connectNetwork(id, container, {});
      } else {
        await provider.disconnectNetwork(id, container, false);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : serverT("api.unknownError");
      audit({
        userId: actor.userId,
        username: actor.username,
        action: `docker.${body.action.replace("-", "_")}`,
        targetType: "network",
        targetId: id || String((body.spec as Record<string, unknown>)?.name ?? ""),
        detail: message,
        result: "error",
      });
      return Response.json({ error: message }, { status: 500 });
    }

    audit({
      userId: actor.userId,
      username: actor.username,
      action: `docker.${body.action.replace("-", "_")}`,
      targetType: "network",
      targetId: id || String((body.spec as Record<string, unknown>)?.name ?? ""),
      detail: container || undefined,
      result: "ok",
    });

    return Response.json({ ok: true, ...(await collect()) });
  }

  if (body.action === "tag" || body.action === "untag") {
    const reference = typeof body.reference === "string" ? body.reference : "";
    const result =
      body.action === "tag"
        ? await tagImage(typeof body.id === "string" ? body.id : "", reference, actor)
        : await untagImage(reference, actor);

    return Response.json(
      result.ok
        ? { ok: true, message: result.message, ...(await collect()) }
        : { ok: false, error: result.message },
      { status: result.ok ? 200 : 400 },
    );
  }

  if (body.action === "volume-create") {
    const spec = (body.spec ?? {}) as Record<string, unknown>;
    const result = await createVolume(
      {
        name: String(spec.name ?? ""),
        driver: String(spec.driver ?? "local"),
        options:
          spec.options && typeof spec.options === "object"
            ? (spec.options as Record<string, string>)
            : {},
        labels:
          spec.labels && typeof spec.labels === "object"
            ? (spec.labels as Record<string, string>)
            : {},
      },
      actor,
    );

    return Response.json(
      result.ok
        ? { ok: true, message: result.message, ...(await collect()) }
        : { ok: false, error: result.message },
      { status: result.ok ? 200 : 400 },
    );
  }

  if (body.action === "clone") {
    const result = await cloneVolume(
      typeof body.id === "string" ? body.id : "",
      typeof body.target === "string" ? body.target : "",
      actor,
    );

    return Response.json(
      result.ok
        ? { ok: true, message: result.message, ...(await collect()) }
        : { ok: false, error: result.message },
      { status: result.ok ? 200 : 400 },
    );
  }

  const kind = body.kind as ResourceKind;
  const id = typeof body.id === "string" ? body.id : "";
  if (!KINDS.includes(kind) || id === "") {
    return Response.json({ error: serverT("api.docker.invalidResource") }, { status: 400 });
  }

  try {
    await getDockerProvider().removeResource(kind, id, body.force === true);
  } catch (error) {
    const message = error instanceof Error ? error.message : serverT("api.unknownError");
    audit({
      userId: guard.session.user.id,
      username: guard.session.user.username,
      action: `docker.remove_${kind}`,
      targetId: id,
      detail: message,
      result: "error",
    });
    return Response.json({ error: message }, { status: 500 });
  }

  audit({
    userId: guard.session.user.id,
    username: guard.session.user.username,
    action: `docker.remove_${kind}`,
    targetId: id,
    result: "ok",
  });

  return Response.json({ ok: true, ...(await collect()) });
}
