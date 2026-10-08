# Loglar — /logs
Son güncelleme: 2026-10-08 · commit 428d5e8

## Ne yapar
Container ve sistem (journald) loglarını periyodik toplayıp SQLite FTS5'te saklar; geçmişte arama, önem derecesi filtresi, indirme ve "kalıp" kuralları (ör. şu metin geçerse önem=hata) sunar.

## Dosyalar
- Sayfa: `src/app/(panel)/logs/page.tsx` — `requirePermission("logs.view")`, `pageHostId({ agent: true })`.
- Ekran: `src/app/(panel)/logs/LogsScreen.tsx` (654).
- API:
  - `src/app/api/logs/route.ts` GET (arama), POST (şimdi topla) — `logs.view`, `{ agent: true }`
  - `src/app/api/logs/patterns/route.ts` POST/PATCH/DELETE — `settings.edit`
- lib: `src/lib/logs/collect.ts` (toplayıcı, imleçler), `src/lib/logs/store.ts` (yazım, FTS arama, budama), `src/lib/logs/types.ts`.
- Tablolar: `log_lines`, `log_cursors`, `log_patterns` (`014_logs.ts`); imleçler sunucu başına (`030_log_cursors_per_host.ts`).
- Job: toplama ve budama `src/lib/jobs/definitions.ts`'te tanımlı (bkz. `jobs.md`).
- Locale: `logsScreen.*`.

## Önemli kararlar ve tuzaklar
- Canlı akış (Docker sayfasındaki log izleme) hiçbir şey saklamaz; burası "dün 03:00'te ne oldu" içindir — bu yüzden akış değil periyodik çekme + imleç.
- Arama metni FTS5 sorgusu ya da düz metin; store güvenli biçime çevirir.
- journald okuma host-helper üzerinden (`journal_*` action'ları, `host-helper/panel-helper.py`); uzak sunucuda helper gerekir.
