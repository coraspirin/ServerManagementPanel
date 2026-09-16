import { serverT } from "@/lib/i18n/runtime";
import { guardApi } from "@/lib/auth/api";
import { audit } from "@/lib/auth/audit";
import { analyzeUsage, listDirectory, openForDownload, readTextFile } from "@/lib/files/browse";
import { allowedRoots } from "@/lib/files/paths";
import {
  changeMode,
  createDirectory,
  removeEntry,
  renameEntry,
  writeFile,
} from "@/lib/files/write";

export const dynamic = "force-dynamic";

function fail(error: unknown): Response {
  const message = error instanceof Error ? error.message : serverT("api.unexpectedError");
  // ENOENT/EACCES gibi sistem hataları kullanıcıya anlaşılır çevriliyor;
  // "Error: ENOENT: no such file or directory, scandir '/host/root/x'"
  // container ayrıntısını da sızdırırdı.
  if (message.includes("ENOENT")) {
    return Response.json({ error: serverT("api.files.notFound") }, { status: 404 });
  }
  if (message.includes("EACCES") || message.includes("EPERM")) {
    return Response.json({ error: serverT("api.files.noRead") }, { status: 403 });
  }
  if (message.includes("ENOTDIR")) {
    return Response.json({ error: serverT("api.files.notDir") }, { status: 400 });
  }
  return Response.json({ error: message }, { status: 400 });
}

export async function GET(request: Request) {
  const guard = await guardApi(request, "files.read");
  if (!guard.ok) return guard.response;

  const url = new URL(request.url);
  const target = url.searchParams.get("path") ?? "/";
  const mode = url.searchParams.get("mode") ?? "list";

  try {
    if (mode === "download") {
      const file = await openForDownload(target);
      audit({
        userId: guard.session.user.id,
        username: guard.session.user.username,
        action: "files.download",
        targetType: "file",
        targetId: target,
        detail: `${file.sizeBytes} bayt`,
        result: "ok",
      });

      return new Response(file.stream, {
        headers: {
          "content-type": "application/octet-stream",
          "content-length": String(file.sizeBytes),
          // Dosya adı ASCII dışı olabilir; RFC 5987 biçimi tarayıcıların
          // doğru adı kullanmasını sağlar.
          "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(file.name)}`,
        },
      });
    }

    if (mode === "read") {
      return Response.json(await readTextFile(target));
    }

    if (mode === "usage") {
      return Response.json(await analyzeUsage(target));
    }

    return Response.json({ ...(await listDirectory(target)), roots: allowedRoots() });
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: Request) {
  const guard = await guardApi(request, "files.write");
  if (!guard.ok) return guard.response;

  const contentType = request.headers.get("content-type") ?? "";

  // Yükleme multipart olarak geliyor; diğer işlemler JSON.
  if (contentType.includes("multipart/form-data")) {
    const form = await request.formData();
    const file = form.get("file");
    const dir = String(form.get("path") ?? "");

    if (!(file instanceof File)) {
      return Response.json({ error: serverT("api.notFound.file") }, { status: 400 });
    }

    const target = `${dir.replace(/\/+$/, "")}/${file.name}`;
    const outcome = await writeFile(target, Buffer.from(await file.arrayBuffer()));

    audit({
      userId: guard.session.user.id,
      username: guard.session.user.username,
      action: "files.upload",
      targetType: "file",
      targetId: target,
      detail: outcome.ok ? `${file.size} bayt` : outcome.message,
      result: outcome.ok ? "ok" : "error",
    });

    return Response.json(
      { ok: outcome.ok, message: outcome.message },
      { status: outcome.ok ? 200 : 400 },
    );
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: serverT("api.invalidRequest") }, { status: 400 });
  }

  const action = String(body.action ?? "");
  const target = String(body.path ?? "");
  let outcome: { ok: boolean; message: string };

  switch (action) {
    case "mkdir":
      outcome = await createDirectory(target);
      break;
    case "delete":
      outcome = await removeEntry(target, Boolean(body.recursive));
      break;
    case "rename":
      outcome = await renameEntry(target, String(body.newName ?? ""));
      break;
    case "chmod":
      outcome = await changeMode(target, String(body.mode ?? ""));
      break;
    case "write":
      outcome = await writeFile(target, Buffer.from(String(body.content ?? ""), "utf8"));
      break;
    default:
      return Response.json({ error: serverT("api.unknownAction") }, { status: 400 });
  }

  audit({
    userId: guard.session.user.id,
    username: guard.session.user.username,
    action: `files.${action}`,
    targetType: "file",
    targetId: target,
    detail: outcome.ok
      ? action === "rename"
        ? `→ ${String(body.newName ?? "")}`
        : action === "chmod"
          ? String(body.mode ?? "")
          : ""
      : outcome.message,
    result: outcome.ok ? "ok" : "error",
  });

  return Response.json(
    { ok: outcome.ok, message: outcome.message },
    { status: outcome.ok ? 200 : 400 },
  );
}
