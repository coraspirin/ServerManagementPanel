import { auditAction } from "@/lib/apiv1/action";
import { guardV1 } from "@/lib/apiv1/guard";
import { LIMITS, clampedNumber } from "@/lib/apiv1/paginate";
import { readJsonBody } from "@/lib/apiv1/parse";
import { apiError, apiOk } from "@/lib/apiv1/respond";
import { serializeMonitor } from "@/lib/apiv1/serialize";
import { createMonitor, monitorViews, parseMonitorInput } from "@/lib/monitors/store";
import { getNumber } from "@/lib/settings";

export const dynamic = "force-dynamic";

/**
 * Monitör listesi + anlık durum.
 *
 * `monitorViews(dayCount)` varsayılan 60 günlük şerit hesaplıyor; burada 0
 * geçiliyor çünkü v1 şekli o şeridi zaten dışarı vermiyor (serialize.ts) ve
 * monitör başına 60 günün uptime toplamını hesaplamak boşa sorgu olurdu.
 *
 * Sınır İMLEÇSİZ: monitör sayısı ev sunucusunda onlarla ölçülür ve liste
 * `sort_order`'a göre sabit. İmleç, sürekli yeni satır alan `events` için
 * gerekliydi (sayfa kayması); burada karşılığı olmayan bir karmaşıklık
 * olurdu. Tavan yine de var — sınırsız bir liste ucu bırakmamak kuralın
 * kendisi, listenin bugün kısa olması değil.
 */
export async function GET(request: Request) {
  const guard = await guardV1(request, "metrics.view");
  if (!guard.ok) return guard.response;

  const search = new URL(request.url).searchParams;
  const limit = clampedNumber(
    search.get("limit"),
    LIMITS.collection.fallback,
    1,
    LIMITS.collection.max,
  );

  const all = monitorViews(0);
  return apiOk({
    hostId: 1,
    monitors: all.slice(0, limit).map(serializeMonitor),
    hasMore: all.length > limit,
  });
}

export async function POST(request: Request) {
  const guard = await guardV1(request, "monitors.manage");
  if (!guard.ok) return guard.response;

  const body = await readJsonBody(request, getNumber("api.max_body_bytes"));
  if (!body.ok) return body.response;

  // Doğrulama panelin kendi ucuyla AYNI fonksiyondan geçiyor: dış yüzeyin
  // panelin kabul etmediği bir kaydı yazabilmesi, doğrulamanın tanımını
  // bozardı.
  const parsed = parseMonitorInput(body.body);
  if (!parsed.ok) return apiError("invalid_request", parsed.error);

  const id = createMonitor(parsed.input);

  auditAction(guard.actor, {
    action: "monitors.create",
    targetType: "monitor",
    targetId: String(id),
    detail: `${parsed.input.type} → ${parsed.input.target}`,
  });

  const view = monitorViews(0).find((monitor) => monitor.id === id);

  // 201 + Location: istemci kaydın adresini yanıt gövdesinden çıkarmak zorunda
  // kalmasın. İç uç 200 dönüyor çünkü ekranın adrese ihtiyacı yok.
  return apiOk(
    { monitor: view ? serializeMonitor(view) : null },
    { status: 201, headers: { Location: `/api/v1/monitors/${id}` } },
  );
}
