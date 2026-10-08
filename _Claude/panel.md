# Ana sayfa (gösterge paneli) — /panel
Son güncelleme: 2026-10-08 · commit 428d5e8

## Ne yapar
Girişten sonraki ana sayfa: saat, hava, internet göstergesi, hızlı bağlantılar, uygulama kartları, yer imleri ve düzenlenebilir widget ızgarası (kaynak kartları, durum şeridi, container özeti, uptime, son olaylar, yedek durumu, filo kartı — tüm sunucular). Bakım bölümü: imaj güncellemeleri, OS güncellemeleri, yedek özeti.

## Dosyalar
- Sayfa: `src/app/(panel)/panel/page.tsx` (58) — `requireSession()`, `pageHostId({ agent: true })`.
- Bileşenler `src/components/home/`: `dashboard.tsx` (373), `DashboardGrid.tsx`, `LayoutEditor.tsx`, `Clock`, `WeatherCard`, `InternetIndicator`, `QuickLinks`; `widgets/` → `ResourceCards` (359), `StatusStrip`, `ContainerSummary`, `UptimeWidget`, `RecentEvents`, `BackupStatus`, `FleetCard`, `WidgetCard`, `AckButton`.
- Bakım: `src/components/maintenance/{MaintenanceSection,ImageUpdatePanel}.tsx`.
- Kabuk: `src/components/shell/HostSelector.tsx` (sunucu seçici), `src/lib/nav.ts` (menü).
- API: `src/app/api/dashboard/route.ts` GET/POST (`panel.view`; düzen kaydı), `api/updates/images` GET/POST (`docker.view`/`docker.action`), `api/events`, `api/metrics/{series,system}`, `api/docker/<id>/...` (güncelle).
- lib: `src/lib/dashboard/{catalog,store,summary}.ts` (widget katalogu; özetler mümkün olduğunca DB'den), `src/lib/home/{weather,internet,bookmarks}.ts`, `src/lib/updates/{images,os,normalize,index}.ts`, `src/lib/backup/{overview,watch}.ts`.
- Ajan op'ları: `updates.osReport`, `backup.scanDir`.
- Tablolar: `dashboard_widgets` (`020`, `031`), ayrıca `apps`, `events`, `monitors`, `backup_*`, `metrics_raw` okunur.
- Locale: `home.*`, `dashboard.*`, `maintenance.*`, `overview.*`.

## Önemli kararlar ve tuzaklar
- Yeni widget = `dashboard/catalog.ts`'e bir satır + bileşen; kayıtlı kullanıcı düzenleri sapma olarak saklandığından güncelleme gerekmez.
- Uzak sunucuya canlı istek yalnız container durumu için ve süre sınırlı (çevrimdışı ajan ana sayfayı bekletmesin).
- Hava: Open-Meteo (anahtarsız), 15 dk önbellek. OS güncelleme raporu host'ta `scripts/os-updates.sh` üretir, panel yalnız okur.
- Güncelleme önbelleği eski sürümün yazdığı satırları okuyabilir → `normalize.ts` (yaşanmış çökme).
