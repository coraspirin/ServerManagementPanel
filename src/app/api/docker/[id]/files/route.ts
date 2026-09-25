import { serverT } from "@/lib/i18n/runtime";
import { enterHost, guardHostApi } from "@/lib/auth/api";
import {
  listContainerPath,
  maxFileBytes,
  readContainerFile,
  writeContainerFile,
} from "@/lib/docker/files";
import { normalizePath, writeBlocked } from "@/lib/docker/listing";
import { getDockerProvider } from "@/lib/providers";

export const dynamic = "force-dynamic";

/**
 * Container içi dosya tarayıcı ucu (M3.23).
 *
 * ⚠️ İZİN AYRIMI KASITLI VE KRİTİK: gezme/okuma `docker.view`, YAZMA
 * `docker.action`. Bir container'ın dosyasını değiştirmek o uygulamayı ele
 * geçirmekle aynı şey — yapılandırmasını, betiklerini, hatta çalıştırdığı
 * ikiliyi değiştirebilirsin. Salt-okur bir kullanıcının bunu yapabilmesi,
 * "görüntüleme" izninin anlamını yok ederdi.
 */

/** Container adını denetim kaydı için çözer; id her recreate'te değişir. */
async function containerName(id: string): Promise<string> {
  try {
    const state = await getDockerProvider().inspect(id);
    return state?.name ?? id;
  } catch {
    return id;
  }
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await guardHostApi(request, "docker.view", { agent: true });
  if (!guard.ok) return guard.response;
  enterHost(guard.hostId);

  const id = (await params).id;
  const url = new URL(request.url);
  const target = normalizePath(url.searchParams.get("path") ?? "/");
  const mode = url.searchParams.get("mode") ?? "list";

  if (mode === "list") {
    const result = await listContainerPath(id, target);
    return Response.json(
      result.ok
        ? { ...result, writeBlocked: writeBlocked(target), maxBytes: maxFileBytes() }
        : result,
      { status: result.ok ? 200 : 400 },
    );
  }

  // Okuma ve indirme aynı uç: fark yalnızca yanıtın nasıl paketlendiği.
  const result = await readContainerFile(id, target);
  if (!result.ok) return Response.json({ error: result.error }, { status: 400 });

  const limit = maxFileBytes();
  if (result.entry.data.length > limit) {
    return Response.json(
      {
        error:
          serverT("api.docker.fileTooLarge", { limit: Math.round(limit / 1024), size: result.entry.data.length }),
      },
      { status: 413 },
    );
  }

  if (mode === "download") {
    const name = target.split("/").pop() || "dosya";
    return new Response(new Uint8Array(result.entry.data), {
      headers: {
        "content-type": "application/octet-stream",
        // Türkçe karakterli adlar için RFC 5987 biçimi.
        "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(name)}`,
      },
    });
  }

  // mode=text — düzenleyici için. İkili dosyayı metin diye göstermek
  // kullanıcıyı kaydettiğinde dosyayı bozmaya götürürdü, bu yüzden önce
  // NUL baytına bakılıyor.
  const data = result.entry.data;
  const ikili = data.subarray(0, 8000).includes(0);

  return Response.json({
    ok: true,
    path: target,
    size: data.length,
    binary: ikili,
    mode: result.entry.mode,
    text: ikili ? "" : data.toString("utf8"),
    writeBlocked: writeBlocked(target),
  });
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await guardHostApi(request, "docker.action", { agent: true });
  if (!guard.ok) return guard.response;
  enterHost(guard.hostId);

  const id = (await params).id;

  let body: { path?: unknown; text?: unknown; base64?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: serverT("api.invalidRequest") }, { status: 400 });
  }

  const target = normalizePath(String(body.path ?? ""));
  if (target === "/") return Response.json({ error: serverT("api.pathRequired") }, { status: 400 });

  if (writeBlocked(target)) {
    return Response.json(
      {
        error:
          serverT("api.docker.writeBlocked", { target }),
      },
      { status: 403 },
    );
  }

  let data: Buffer;
  if (typeof body.base64 === "string") {
    data = Buffer.from(body.base64, "base64");
  } else if (typeof body.text === "string") {
    data = Buffer.from(body.text, "utf8");
  } else {
    return Response.json({ error: serverT("api.contentRequired") }, { status: 400 });
  }

  const result = await writeContainerFile(
    id,
    target,
    data,
    { username: guard.session.user.username, userId: guard.session.user.id },
    await containerName(id),
  );

  return Response.json(result, { status: result.ok ? 200 : 400 });
}
