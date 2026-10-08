import { serverT } from "@/lib/i18n/runtime";
import { enterHost, guardHostApi } from "@/lib/auth/api";
import { audit } from "@/lib/auth/audit";
import { dumpPlan } from "@/lib/dbadmin/exec/runner";
import { connectionSecrets } from "@/lib/dbadmin/store";
import { getDockerProvider } from "@/lib/providers";
import type { ThrowawayEvent } from "@/lib/providers/types";

export const dynamic = "force-dynamic";

/**
 * Tek veritabanının SQL dökümü (`.sql.gz`) — envanter sunucuları için.
 *
 * Döküm geçici container'da üretilir ve base64 satırları olarak akar (bkz.
 * `dumpPlan`); burada çözülüp olduğu gibi indirilir, diske yazılmaz.
 *
 * İlk veri gelene kadar beklenir: araç hemen hata verirse (kimlik, sürüm
 * uyuşmazlığı) kullanıcı boş bir dosya yerine açıklamalı bir hata görür.
 * Akış ortasında hata olursa bağlantı hatayla kesilir — tarayıcı indirmeyi
 * başarısız sayar, yarım dosya "tamam" gibi görünmez.
 *
 * İzin `db.read`: tüm tabloları SELECT edebilen biri dökümü de alabilir;
 * yine de her döküm audit'e yazılır.
 */
export async function GET(request: Request) {
  const guard = await guardHostApi(request, "db.read", { agent: true });
  if (!guard.ok) return guard.response;
  enterHost(guard.hostId);

  const url = new URL(request.url);
  const found = connectionSecrets(Number(url.searchParams.get("id") ?? 0));
  const database = (url.searchParams.get("database") ?? "").trim();
  if (!found || found.transport === "tcp") {
    return Response.json({ error: serverT("api.db.connectionOrPasswordMaster") }, { status: 400 });
  }
  if (!/^[A-Za-z0-9_$-]{1,64}$/.test(database)) {
    return Response.json({ error: serverT("dbadmin.admin.badName") }, { status: 400 });
  }
  const connection = { ...found, database };

  const record = (ok: boolean, detail: string) =>
    audit({
      userId: guard.session.user.id,
      username: guard.session.user.username,
      action: "db.dump",
      targetType: "db_connection",
      targetId: String(connection.id),
      detail: `${connection.container || connection.meta.service || connection.engine}/${database}${detail ? ` — ${detail}` : ""}`,
      result: ok ? "ok" : "error",
    });

  let plan;
  try {
    plan = await dumpPlan(connection, database);
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }

  const abort = new AbortController();
  request.signal.addEventListener("abort", () => abort.abort(), { once: true });
  const events = getDockerProvider().runThrowawayStream(plan.spec, abort.signal);
  const errors: string[] = [];

  const failure = (event: Extract<ThrowawayEvent, { type: "exit" }>): string | null => {
    const marked = errors.some((line) => line.includes(plan.marker));
    if (event.exitCode === 0 && !marked && !event.timedOut && !event.cancelled) return null;
    const text = errors.filter((line) => !line.includes(plan.marker)).join("\n").trim();
    return (text || serverT("dbadmin.execFailed", { code: event.exitCode })).slice(0, 600);
  };

  // Veri gelmeye başlayana (ya da bitişe) kadar oku.
  const head: Buffer[] = [];
  let finished: Extract<ThrowawayEvent, { type: "exit" }> | null = null;
  try {
    for (;;) {
      const next = await events.next();
      if (next.done) break;
      const event = next.value;
      if (event.type === "exit") {
        finished = event;
        break;
      }
      if (event.stream === "stderr") {
        errors.push(event.text);
        continue;
      }
      head.push(Buffer.from(event.text, "base64"));
      // Hemen başarısız olan araç da gzip başlığı + bitişi kadar (tek satır)
      // çıktı üretiyor; iki satır gerçek verinin geldiğini gösteriyor.
      if (head.length >= 2) break;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    record(false, message);
    return Response.json({ error: message }, { status: 400 });
  }

  if (finished) {
    const problem = failure(finished);
    if (problem) {
      record(false, problem);
      return Response.json({ error: problem }, { status: 400 });
    }
  }

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of head) controller.enqueue(new Uint8Array(chunk));
      if (finished) {
        record(true, "");
        controller.close();
      }
    },
    async pull(controller) {
      try {
        for (;;) {
          const next = await events.next();
          if (next.done) {
            controller.close();
            return;
          }
          const event = next.value;
          if (event.type === "exit") {
            const problem = failure(event);
            record(!problem, problem ?? "");
            if (problem) controller.error(new Error(problem));
            else controller.close();
            return;
          }
          if (event.stream === "stderr") {
            errors.push(event.text);
            continue;
          }
          controller.enqueue(new Uint8Array(Buffer.from(event.text, "base64")));
          return;
        }
      } catch (error) {
        record(false, error instanceof Error ? error.message : String(error));
        controller.error(error);
      }
    },
    cancel() {
      abort.abort();
    },
  });

  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  return new Response(stream, {
    headers: {
      "content-type": "application/gzip",
      "content-disposition": `attachment; filename="${database}-${stamp}.sql.gz"`,
      "cache-control": "no-store",
    },
  });
}
