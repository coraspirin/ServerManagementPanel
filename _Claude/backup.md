# Yedekleme — /backup
Son güncelleme: 2026-10-08 · commit 428d5e8 (v2 yeniden yazımı)

## Ne yapar
restic tabanlı yedekleme, sekmeli sayfa. Sunucu başına üç "sistem" işi: **Docker** (container volume/bind + compose klasörleri), **İşletim Sistemi** (/etc, /home, /root, cron, /opt, /usr/local, dpkg durumu — disk imajı değil), **Veritabanı** (pg/mysql dökümleri + panel DB). Kullanıcı yol yazmaz: kaynaklar otomatik bulunur, işaretlenir. Ayrıca: konumlar (yerel disk, SMB/NFS, S3/B2/MinIO), geçmiş, snapshot gezinme/karşılaştırma/geri yükleme/indirme, eski v1 işleri "Özel işler" olarak, kurulum sihirbazı, kurtarma kiti, aylık otomatik geri yükleme testi.

## Dosyalar
- Sayfa: `src/app/(panel)/backup/page.tsx` — `requirePermission("backup.manage")`, `pageHostId({ agent: true })`.
- Bileşenler: `src/components/backup/` — `BackupPage.tsx` (sekmeler), `OverviewTab.tsx`, `SystemTab.tsx` (626; sistem başına ayarlar EKRANDA), `LocationsTab.tsx` + `LocationForm.tsx`, `HistoryTab.tsx`, `SnapshotBrowser.tsx` (557), `CustomJobs.tsx`, `SetupWizard.tsx`, `parts.tsx`, `client.ts` (istemci yardımcıları, `formatBytes`).
- API: `src/app/api/backup/**` — hepsi `backupGuard()` (`src/lib/backup/http.ts` → `backup.manage`, `{ agent: true }`):
  `route.ts` (özet), `systems/[category]` GET/PUT, `jobs` + `jobs/[id]` + `jobs/[id]/run`, `locations` + `[id]` + `[id]/actions`, `runs` + `runs/[id]`, `live` (SSE ilerleme), `snapshots` (+ `browse`, `diff`), `restore`, `download`, `setup`, `config` (yapılandırma dışa/içe aktarma — `settings.edit`).
- lib `src/lib/backup/`:
  - `engine.ts` — akış: konum kilidi → boş alan → depo hazır/oluştur → kaynakları hazırla (döküm, manifest) → container durdur → restic backup (canlı) → container başlat (HER DURUMDA) → `forget --prune` → istatistik → anormal boyut → bildirim.
  - `sources.ts` — restic container'ındaki yerleşim (`/src/docker/<c>/<hedef>`, `/src/docker/_compose/<proje>`, `/host/...`), DB dökümü (`dumpScript`, `dbTarget`: DB'nin kendi imajında `networkMode: container:<db>`).
  - `discover.ts` — Docker/OS/DB keşfi, `credentialsFromEnv`, `dbEngineOf`, `isSystemBind`.
  - `runner.ts` — restic HOST'A KURULMAZ; her komut geçici container (`resticRun/resticShell/resticStream`, `shellRun`).
  - `restic.ts` (saf komut kurucu + `--json` ayrıştırıcı, testli), `restore.ts`, `verify.ts`, `scheduler.ts` (perHost `backup.scheduler` işi, 10 dk), `queue.ts` (konum başına sıra), `live.ts` (`globalThis` kayıt + SSE), `overview.ts` (tek özet kaynağı: sayfa, ana sayfa, bakım kartı, alarmlar), `kit.ts`, `watch.ts`, `config.ts`, `types.ts`.
  - `store/{jobs,repos,runs}.ts` — sunucuya bağlı kayıtlar; konum gizli alanları `env_enc` (MASTER_KEY ile şifreli).
- Tablolar: `backup_repos`, `backup_jobs`, `backup_runs` (`015_backup.ts`, `026`, `033_backup_v2.ts`), `backup_sources` (`033`). Sistem işleri `sys:<kategori>:<sunucu>` adıyla (ad UNIQUE kısıtı yüzünden).
- Locale: `backup.*`.

## Çoklu sunucu
Tüm restic/döküm container'ları sağlayıcı katmanıyla seçili sunucunun Docker'ında açılır (`runThrowaway`, `runThrowawayStream` — `AGENT_PROTOCOL=3`). İndirme (download) yalnız yerel sunucuda.

## Önemli kararlar ve tuzaklar
- Kullanıcı kararları: restic kalır; mevcut "YEDEK" deposu + "Yedek" işi korunur (`custom`, `/data` yolu aynı — önceki snapshot parent bulunsun). Reddedilenler: ikinci kopya (3-2-1), ayrı `backup.view` izni.
- SMB/NFS kimlikleri restic'e gitmez; Docker volume sürücüsü (cifs/nfs) ile bağlanır.
- Geri yükleme tek yazma işlemi; varsayılan "yeni klasöre çıkar", yerine yazma ad yazdırılarak onaylanır.
- DB dökümü kimliği: container env (root tercihli), yoksa veritabanı sayfasındaki KULLANICI ADI DOLU bağlantı (envanterin kimliksiz satırları sayılmaz).
- Henüz yapılmayan: sunucuda gerçek restic koşusu ile doğrulama; "ilk kurulumda yedekten geri yükle".
- Plan: `C:\Users\mucah\.claude\plans\starry-chasing-rain.md`.
