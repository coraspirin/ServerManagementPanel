import { guardV1 } from "@/lib/apiv1/guard";
import { apiError, apiOk } from "@/lib/apiv1/respond";
import { METRIC_META, RANGES, isRangeId } from "@/lib/metrics/catalog";
import { querySeriesForRange } from "@/lib/metrics/query";

export const dynamic = "force-dynamic";

/**
 * Zaman serisi: `?metrics=cpu.pct,mem.used_pct&range=24h`
 *
 * Katman (ham / 1dk / 1sa / 1gün) sunucuda seçiliyor ve yanıt hangisinin
 * kullanıldığını söylüyor — istemci "bu nokta 5 saniyelik mi 1 saatlik
 * ortalama mı" sorusunu tahmin etmek zorunda kalmasın.
 *
 * Bilinmeyen metrik SESSİZCE ELENMİYOR, açıkça reddediliyor: sessiz eleme,
 * yazım hatası yapan bir istemciye boş grafik gösterip sebebini gizlerdi.
 * Bu, limit kırpmasından farklı — orada istek anlamlı ama fazla, burada
 * istek anlamsız.
 */
export async function GET(request: Request) {
  const guard = await guardV1(request, "metrics.view");
  if (!guard.ok) return guard.response;

  const params = new URL(request.url).searchParams;

  const requested = (params.get("metrics") ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);

  if (requested.length === 0) {
    return apiError(
      "invalid_request",
      `metrics parametresi gerekli. Geçerli metrikler: ${Object.keys(METRIC_META).join(", ")}`,
    );
  }

  const unknown = requested.filter((metric) => !(metric in METRIC_META));
  if (unknown.length > 0) {
    return apiError("invalid_request", `bilinmeyen metrik: ${unknown.join(", ")}`);
  }

  const range = params.get("range") ?? "24h";
  if (!isRangeId(range)) {
    return apiError(
      "invalid_request",
      `geçersiz aralık. Geçerli değerler: ${RANGES.map((entry) => entry.id).join(", ")}`,
    );
  }

  const result = querySeriesForRange(requested, range);

  return apiOk({
    hostId: 1,
    range,
    tier: result.tier,
    resolutionSeconds: result.resolution,
    from: result.from,
    to: result.to,
    series: result.series.map((entry) => ({
      metric: entry.metric,
      label: entry.label,
      points: entry.points.map((point) => ({
        ts: point.ts,
        avg: point.avg,
        min: point.min,
        max: point.max,
      })),
    })),
  });
}
