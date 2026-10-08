# İzleme — /monitoring
Son güncelleme: 2026-10-08 · commit 428d5e8

## Ne yapar
Sunucu metrik grafikleri (CPU, bellek, disk, ağ, yük…) seçilebilir aralıkla; donanım sağlığı (sıcaklık, S.M.A.R.T, mdraid, ZFS) ve kapasite tahmini ("disk N gün sonra dolar").

## Dosyalar
- Sayfa: `src/app/(panel)/monitoring/page.tsx` (69) — `requirePermission("metrics.view")`, `pageHostId({ agent: true })`.
- Ekran: `MonitoringScreen.tsx` (432); bileşenler `src/components/metrics/{MetricChart,CapacityPanel,HardwarePanel}.tsx`.
- API: `src/app/api/metrics/series/route.ts`, `src/app/api/metrics/system/route.ts` — GET, `metrics.view`, `{ agent: true }`. Donanım: `src/app/api/hardware/route.ts`.
- lib:
  - `src/lib/metrics/collect.ts` — toplama (tek ts, tek işlem), job ile.
  - `src/lib/metrics/query.ts` — aralığa göre doğru katmanı (raw / özet) seçer.
  - `src/lib/metrics/forecast.ts` — en küçük kareler; yetersiz veri / kötü uyumda tahmin YOK.
  - `src/lib/metrics/catalog.ts` — metrik meta + `formatBytes` vb. (istemci de kullanır, `server-only` değil).
  - Sağlayıcılar: `src/lib/providers/metrics.{live,mock}.ts`, `hardware.{live,mock}.ts`.
- Tablolar: `metrics_raw` (`001_foundation.ts`) + özet katmanları; `host_id`'li (`026`).
- Locale: `metrics.*`, `hardware.*`, `capacity.*`, `metricChart.*`.

## Çoklu sunucu
Uzak sunucunun metrikleri ajandan `metrics.sample` / `hardware.report` op'larıyla gelir, merkezde saklanır.

## Önemli kararlar ve tuzaklar
- Container içinden HOST metrikleri: `/proc/net/dev` ağ ad alanına bağlı → host'unki ayrıca okunur (`metrics.live.ts` açıklaması).
- S.M.A.R.T/ZFS host'ta çalışan betikten gelir (`scripts/hardware.sh`, host cron) — `smartctl` ham disk erişimi ister.
- MOCK_MODE üreteci deterministik (zamanın fonksiyonu) → geriye dönük doldurma mümkün.
