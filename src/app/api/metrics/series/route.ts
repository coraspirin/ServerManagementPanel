import { serverT } from "@/lib/i18n/runtime";
import { enterHost, guardHostApi } from "@/lib/auth/api";
import { METRIC_META, isRangeId } from "@/lib/metrics/catalog";
import { querySeriesForRange } from "@/lib/metrics/query";

export const dynamic = "force-dynamic";

/**
 * Grafik verisi (M1.1).
 *
 * `?metrics=cpu.pct,mem.used_pct&range=24h`
 *
 * Katman seçimi sunucuda yapılır ve yanıt hangi katmanın kullanıldığını da
 * söyler; grafik altında "1 saatlik ortalama" yazabilelim diye.
 */
export async function GET(request: Request) {
  const guard = await guardHostApi(request, "metrics.view");
  if (!guard.ok) return guard.response;
  enterHost(guard.hostId);

  const params = new URL(request.url).searchParams;

  const requested = (params.get("metrics") ?? "")
    .split(",")
    .map((m) => m.trim())
    .filter(Boolean);

  // Şemada olmayan bir metrik istemek anlamsız; sessizce elenirse hata
  // ayıklamak zorlaşır, bu yüzden açıkça reddediliyor.
  const unknown = requested.filter((metric) => !(metric in METRIC_META));
  if (unknown.length > 0) {
    return Response.json(
      { error: serverT("api.unknownMetric", { names: unknown.join(", ") }) },
      { status: 400 },
    );
  }
  if (requested.length === 0) {
    return Response.json({ error: serverT("api.metricsRequired") }, { status: 400 });
  }

  const range = params.get("range") ?? "24h";
  if (!isRangeId(range)) {
    return Response.json({ error: serverT("api.invalidRange") }, { status: 400 });
  }

  // `label` isteğe bağlı: etiketli metriklerde tek bir kaynağın (container,
  // disk, arayüz) serisini istemeye yarıyor. Verilmezse hepsi döner.
  const label = params.get("label");

  return Response.json(querySeriesForRange(requested, range, label ?? undefined));
}
