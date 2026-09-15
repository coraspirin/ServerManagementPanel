import { guardApi } from "@/lib/auth/api";
import { audit } from "@/lib/auth/audit";
import { exportConfig, importConfig, type ConfigExport } from "@/lib/backup/config";

export const dynamic = "force-dynamic";

/** Yapılandırmayı JSON olarak indirir (M2.13). */
export async function GET(request: Request) {
  // Dışa aktarım tüm ayarları içeriyor; `settings.view` yetmez, düzenleme
  // yetkisi isteniyor: bu dosya başka bir kurulumu şekillendirebilir.
  const guard = await guardApi(request, "settings.edit");
  if (!guard.ok) return guard.response;

  const data = exportConfig();

  audit({
    userId: guard.session.user.id,
    username: guard.session.user.username,
    action: "config.export",
    detail: `${data.settings.length} ayar · ${data.apps.length} kart · ${data.monitors.length} monitör`,
    result: "ok",
  });

  const stamp = new Date().toISOString().slice(0, 10);
  return new Response(JSON.stringify(data, null, 2), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="panel-yapilandirma-${stamp}.json"`,
    },
  });
}

export async function POST(request: Request) {
  const guard = await guardApi(request, "settings.edit");
  if (!guard.ok) return guard.response;

  let data: ConfigExport;
  try {
    data = (await request.json()) as ConfigExport;
  } catch {
    return Response.json({ error: "Dosya geçerli JSON değil." }, { status: 400 });
  }

  const outcome = importConfig(data, guard.session.user.username);

  audit({
    userId: guard.session.user.id,
    username: guard.session.user.username,
    action: "config.import",
    detail: outcome.ok
      ? Object.entries(outcome.result.applied)
          .map(([key, value]) => `${key}:${value}`)
          .join(" ")
      : outcome.error,
    result: outcome.ok ? "ok" : "error",
  });

  if (!outcome.ok) return Response.json({ error: outcome.error }, { status: 400 });
  return Response.json({ ok: true, ...outcome.result });
}
