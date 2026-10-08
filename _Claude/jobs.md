# Panel işleri — /jobs
Son güncelleme: 2026-10-08 · commit 428d5e8

## Ne yapar
Panelin arka plan işlerini (metrik toplama, log toplama, yedek zamanlayıcı, uyarılar, budama…) son çalışma sonucu ve süresiyle listeler; sıklık değiştirme, açma/kapama ve elle çalıştırma.

## Dosyalar
- Sayfa: `src/app/(panel)/jobs/page.tsx` — `requirePermission("settings.view")`; merkezi.
- Ekran: `src/app/(panel)/jobs/JobsScreen.tsx` (181).
- API: `src/app/api/jobs/route.ts` GET (`settings.view`), POST (`settings.edit`).
- lib:
  - `src/lib/jobs/definitions.ts` (585) — tüm işlerin listesi; çoğu `perHost` ile her etkin sunucuda o sunucunun bağlamında koşar.
  - `src/lib/jobs/runner.ts` (288) — süreç içi zamanlayıcı + kilit.
  - `src/lib/cron/friendly.ts` — cron ↔ insan dili (kullanıcıya ham cron gösterilmez).
- Tablolar: `jobs`, `job_locks`, `job_runs` (`004_jobs.ts`; `026_multi_host.ts` host_id ekler).
- Locale: `jobs.screen.*`, `jobs.status.*`.

## Önemli kararlar ve tuzaklar
- Plandan sapma: ayrı worker süreci YOK; runner Next sürecinin içinde (`src/instrumentation.ts` başlatır). Standalone çıktı ikinci bir TS worker'ı paketlemiyor.
- Kilit tablosu aynı işin üst üste koşmasını engeller.
- Yeni iş: `definitions.ts`'e ekle + locale'de ad/açıklama; çoklu sunucu gerekiyorsa `perHost`.
