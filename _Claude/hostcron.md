# Host zamanlanmış görevleri — /hostcron
Son güncelleme: 2026-10-08 · commit 428d5e8

## Ne yapar
Host'un crontab'ını yönetir: panelin eklediği görevler (düzenlenebilir) ve sistemde mevcut olanlar (salt-okunur). Sıklık insan diliyle seçilir, ham cron gösterilmez; görevi çalıştıracak host kullanıcısı listeden seçilir.

## Dosyalar
- Sayfa: `src/app/(panel)/hostcron/page.tsx` — `requirePermission("cron.manage")`; YALNIZ YEREL sunucu.
- Ekran: `HostCronScreen.tsx` (409); bileşenler `src/components/settings/CronEditor.tsx`, `HostUserSelect.tsx`.
- API:
  - `src/app/api/hostcron/route.ts` GET, POST — `cron.manage`, `{ localOnly: true }`
  - `src/app/api/host/users/route.ts` GET — host kullanıcı/grup listesi, `{ agent: true }`
- lib: `src/lib/hostcron/index.ts` (348), `src/lib/cron/friendly.ts`, `src/lib/host/users.ts` (`onHost("host.accounts")`), `src/lib/files/elevated.ts` (`elevatedList/elevatedRead` okuma), yazma `hostcron/index.ts` içinde panel imajından root geçici container (`runThrowaway`).
- Locale: `hostcron.*`, `cron.editor.*`, `hostUser.*`.

## Önemli kararlar ve tuzaklar
- PANEL İŞLERİYLE KARIŞTIRILMAMALI (`jobs.md`): bunlar host cron'u, panel silinse de çalışır.
- OKUMA yükseltilmiş container'dan (cron dosyaları root'a ait); YAZMA yalnız `/etc/cron.d/panel-*` dosyalarına — sistemin `/etc/crontab`'ına ve kullanıcı crontab'larına dokunulmaz.
- Uzak sunucuda desteklenmez (localOnly).
