# İşlem kaydı

Projede yapılan her işlem buraya, EN YENİ EN ÜSTTE olacak şekilde tarih damgasıyla eklenir.

Biçim:
```
## YYYY-MM-DD HH:MM — kısa başlık
- Ne yapıldı / neden
- Değişen dosyalar (önemliler)
- Durum: commit edildi mi, test/deploy edildi mi, açık kalanlar
```

---

## 2026-10-11 20:35 — deploy.sh ZimaOS/CasaOS kurulumu için yeniden yazıldı
- İkinci deploy denemesi `mkdir: cannot create directory '/home/coraspirin': Read-only file system` ile düştü. İnceleme (salt okunur, root SSH): sunucu artık ZimaOS 1.7.1 (CasaOS); panel CasaOS uygulaması `server-management-panel` (GHCR 1.13.0 imajı, port 8081, veri `/DATA/AppData/server-panel`, compose `/var/lib/casaos/apps/compose-75a5218c7cbc9fd0`). Caddy yok.
- Kullanıcı seçimi (seçenek 1): kaynak `/DATA/AppData/server-panel-src`'ye, imaj sunucuda derlenir (`server-panel:local`), CasaOS compose'unda yalnız `image:` değişir (yedekli), `up -d --pull never`, sağlık kontrolü, önceki yerel imaj silinir. Önceki sürümdeki ilk kurulum/Caddy geçişi mantığı kaldırıldı (bu sunucuda gereksiz).
- Doğrulama: `bash -n` (ana + 4 uzak blok); `image:` değiştirme bloğu CasaOS compose kopyasında denendi (yalnız o satır değişti); 0. adım gerçek sunucuda çalıştırıldı ve doğru çözümledi. Derleme/yeniden başlatma sunucuda ÇALIŞTIRILMADI.
- Belgeler: `surum-deploy.md`, `test-dogrulama.md` (sunucu bilgileri), `kararlar.md`, `yapilacaklar.md`. Durum: commit edilmedi.

## 2026-10-11 18:12 — deploy.sh yeni sisteme göre yeniden yazıldı
- Kullanıcı deploy.sh'ı çalıştırdı: sunucuda `/home/coraspirin/docker/server-panel` yok → 3. adımda düştü. Sunucuyu incelemek için SSH denemesi önce `coraspirin` ile reddedildi (betik `~/.ssh/config` ile root kullanıyor), sonra sunucu bağlantıyı kapattı; incelenemedi.
- deploy.sh: 0. adımda sunucu durumu (ilk kurulum / Caddy'li eski kurulum / güncelleme / docker yok); ilk kurulumda dizin + compose + `.env` (MASTER_KEY, DOCKER_GID üretilir) + `reports/`; Caddy'li kurulumda eski compose `.bak`, caddy durdurulup silinir, yeni compose yazılır; port kontrolü; `up -d --remove-orphans`; container adı `docker compose ps -q panel`'den; kurulum kodu ekrana; `PANEL_HOST`/`PANEL_DIR` ile hedef değiştirilebilir; yedek artık `dirname(PANEL_DIR)/panel-yedek-*.tgz` ve compose/.env/Caddyfile'ı da içeriyor.
- Doğrulama: `bash -n` (ana betik + 4 uzak blok); yükleme bloğu yerelde sahte dizinle üç durumda çalıştırıldı (ilk kurulum dosyaları + .env, güncellemede compose korunuyor/eski src siliniyor/APP_VERSION tek satır, Caddy geçişinde .bak + `docker compose stop/rm caddy` + caddy'siz compose + .env temizliği). Sunucuda çalıştırılmadı.
- Belgeler: `surum-deploy.md`, `yapilacaklar.md`. Durum: commit edilmedi.

## 2026-10-11 17:36 — Panel sadeleştirme + log/olay temizleme
- Kullanıcının isteğiyle tamamen kaldırıldı: Uygulamalar (kartlar, kategoriler, logo, keşif, Pi-hole widget'ı, yer imleri, hızlı bağlantılar), kiosk, herkese açık karşılama sayfası, yayınlama (proxy/Caddy/sertifika/DDNS/teşhis), Tailscale, güvenlik duvarı (ufw) ekranı + helper `ufw.*` eylemleri, dış API (`/api/v1`, API token'ları, `api.manage`, `/metrics`, `docs/API.md`, `docs/openapi.yaml`, `check:openapi`, CI adımları).
- `/` artık yalnız yönlendirir: kurulum → `/kurulum`, oturum → `/panel`, yoksa `/login`. Logo `/panel`'e gider.
- Caddy tamamen kalktı (kullanıcı kararı): compose'da `caddy` servisi/volume'leri ve tailscaled mount'u yok, panel `${PANEL_HTTP_PORT:-8080}:3000`. İstemci IP'si için `scripts/docker-entry.mjs`'e ön katman (`startFront`): Next 127.0.0.1:3001, ön katman `X-Real-IP`/`X-Forwarded-*`'ı soketten yazar; `PANEL_TRUST_PROXY=1` kendi TLS vekili için. `panelPorts()` `security/ports.ts`'e taşındı.
- Migration `035_drop_removed_features.ts`: 9 tablo DROP + izin/ayar/iş/widget artıkları.
- Yeni: `/logs` ve `/events`'e "Kayıtları temizle" — `DELETE /api/logs` (`settings.edit`, `clearLogs`, imleçler korunur) ve `DELETE /api/events` (`monitors.manage`, `clearEvents`); seçili sunucu, `confirm()`, audit `logs.clear`/`events.clear`.
- Locale: ~590 anahtar silindi; paylaşılanlar `common.*`/`api.auth.*`'a taşındı (`proxy.form.port` → `common.port` vb.); kaldırılan özelliklerden bahseden yardım metinleri yeniden yazıldı. Ayar ekranındaki `container`/`richtext` tipleri ve `ContainerSelect`, `RichTextField`, `lib/richtext.ts` gitti.
- Doğrulama: typecheck, eslint, i18n:check (3800/3800), i18n:scan, `npm test` 516/516 (apiv1/firewall testleri silindi), `npm run build`. MOCK dev: eski yerel DB kopyasında şema 25→35 sorunsuz, tablolar düştü, `apps.install` kaldı; boş DB'de kurulum → `/` → `/panel`, sayfalar 200, temizleme uçları (CSRF'siz 403, FTS boşaldı, imleçler kaldı, audit yazıldı). Standalone + ön katman: 0→35 migration, health 200, Next LAN'dan erişilemez, uydurma `X-Forwarded-For: 6.6.6.6` yok sayıldı (audit gerçek IP).
- Belgeler: `_Claude/{README,_digerleri,hesap,host-helper,kararlar,network,panel,security,settings,surum-deploy,tarifler,test-dogrulama,veritabani-sema,logs,events,yapilacaklar}.md`, silindi `apps.md`/`proxy.md`/`firewall.md`; README.md, README_tr.md, screenshots/README.md.
- Durum: commit edilmedi, deploy edilmedi. Açık: sunucuda Caddy'siz compose'a ELLE geçiş (`surum-deploy.md`), `.env.example` (okuma izni engelli) güncellenmedi.

## 2026-10-09 17:43 — İlk kurulum sihirbazı (/kurulum)
- Önceden kullanıcı yoksa `bootstrap.ts` `admin`'i `ADMIN_PASSWORD` ile (yoksa loga rastgele parola) kendisi açıyordu; sihirbaz hiç yoktu. Kullanıcının isteğiyle yerine sihirbaz geldi: açılışta tek kullanımlık kurulum kodu loga basılıyor, `/kurulum` bu kodu isteyip ilk yöneticiyi oluşturuyor ve içeri alıyor. Kullanıcı yokken `/` ve `/login` sihirbaza yönlendiriyor.
- Yeni: `src/lib/auth/setup.ts`, `src/app/api/auth/setup/route.ts`, `src/app/kurulum/{page,SetupForm}.tsx`. Silinen: `src/lib/auth/bootstrap.ts`. Değişen: `instrumentation.ts`, `middleware.ts`, `app/page.tsx`, `app/login/page.tsx`, locale'ler (`bootstrapLib.*` → `setup.*`, `auth.password.forcedNotice` artık loga atıf yapmıyor).
- `ADMIN_USERNAME`/`ADMIN_PASSWORD` kaldırıldı: `docker-compose.yml`, `.env.example`, yerel `.env`, `ci.yml`, 3 README.
- Doğrulama: typecheck, eslint, i18n:check/scan, `npm test` (619/619). Boş veritabanıyla MOCK dev sunucusunda: kod loga basıldı; `/` ve `/login` → `/kurulum`; yanlış kod 403, zayıf parola 400, doğru kod (küçük harf/boşluklu) 200 + oturum; tekrar 409; `/kurulum` → `/login`; yeniden başlatmada kod basılmadı; audit kayıtları doğru. `npm run build` başarılı. Sunucuda deneme yapılmadı.
- Durum: commit edilmedi. Belgeler: `_digerleri.md`, `kararlar.md`, `veritabani-sema.md`.

## 2026-10-09 01:12 — Genel rehberler eklendi
- Yeni: `_Claude/surum-deploy.md` (deploy.sh + `scripts/set-version.sh` + GHCR + ajan güncelleme + geri alma), `yapilacaklar.md` (açık işler, doğrulanmamışlar, bilinen sınırlamalar), `kararlar.md` (mimari karar kaydı), `tarifler.md` (sayfa/uç/op/sağlayıcı/migration/ayar/izin/locale/widget/job ekleme), `test-dogrulama.md`, `veritabani-sema.md` (tüm tablolar, migration, host_id, kullanan lib), `host-helper.md` (eylem listesi, güvenlik, kurulum).
- `_Claude/README.md`'ye "Genel rehberler" tablosu; `CLAUDE.md`'ye iş başında memory/yapilacaklar/kararlar okuma kuralı.
- Düzeltmeler: ayarların tek kaynağı `src/settings.schema.ts` (README/settings.md yanlış gösteriyordu); host cron yazması helper değil geçici container (`hostcron.md`); token yasak izinleri `apiv1/guard.ts` `TOKEN_FORBIDDEN`.
- Yollar betikle doğrulandı. Durum: commit edilmedi.

## 2026-10-09 01:01 — İşlem kaydı (bu dosya) oluşturuldu
- `_Claude/memory.md` açıldı; `CLAUDE.md`'ye "her işlemden sonra buraya kayıt ekle" kuralı eklendi.
- Durum: commit edilmedi.

## 2026-10-09 00:50 — Sayfa rehberleri (`_Claude/*.md`)
- 25 panel sayfası + `_digerleri.md` (/, /login, /kiosk, /metrics) için Türkçe rehber; `_Claude/README.md` dizin + ortak altyapı; kök `CLAUDE.md` (önce rehberi oku, kod değişince güncelle).
- Yollar betikle doğrulandı; `events.md` ve `monitoring.md`'de iki yanlış referans düzeltildi.
- Durum: commit edilmedi.

## 2026-10-08 23:30 — Veritabanı envanterine SQLite dosyaları
- Sorun: Defterim'in DB'si görünmüyordu — ayrı sunucu değil, `defterim_defterim-data` volume'ünde `/data/db/defterim.db` (SQLite). Sunucuda ~20 SQLite DB var.
- `src/lib/dbadmin/exec/sqlite-scan.ts`: container volume/bind'larını root geçici container'da tarar ("SQLite format 3" başlığı, yedek/önbellek/_old filtresi). Dosya başına `db_connections` satırı (`sqlite:<yol>`), ağaçta container'a göre gruplu.
- Değişenler: `exec/inventory.ts`, `store.ts` (`pruneInstances(keys, scanned)`), `types.ts`, `InventoryTree.tsx`, `DatabaseScreen.tsx`, locale.
- Tarama betiği sunucuda panel imajıyla denendi (0,4 sn, defterim.db bulundu). typecheck/lint/619 test/build yeşil.
- Durum: commit edilmedi, deploy edilmedi.

## 2026-10-08 — Veritabanı sayfası otomatik envanter olarak yeniden yazıldı
- Sorun: sayfa yalnız elle kaydedilen bağlantıları listeliyordu; içe aktarılan container'lara ad ile TCP → ajan ayrı ağda (ENOTFOUND); native DB'ler hiç bulunmuyordu.
- Çözüm ("exec transport"): Docker DB → container içinde `docker exec` ile kendi istemcisi; native → panel imajından geçici container + host soketi (MySQL root unix_socket → debian.cnf; Postgres peer). SQL `PANEL_SQL` env → stdin.
- Yönetim: DB oluştur/sil, kullanıcı/parola, yetki (tam/salt-okunur), tek DB `.sql.gz` dökümü.
- Yeni: `src/lib/dbadmin/exec/{runner,inventory,native,admin,parse}.ts`, `api/database/{admin,dump}/route.ts`, `AdminModals.tsx`, `InventoryTree.tsx`, `api.ts`, migration `034_dbadmin_inventory.ts`, `parse.test.ts`.
- Değişen: `providers/types.ts` + `docker.live.ts` (`runOnce` → `{env,user,timeoutMs}` + stdout/stderr), `agent/ops.ts` (`db.native`), `backup/{discover,sources}.ts` (kimliksiz envanter satırları sayılmaz), `Dockerfile` (mariadb-client, postgresql-client, redis-tools), locale'ler.
- Durum: commit edilmedi; sunucuda tam akış denenmedi; uzak ajanlar için yeni sürüm gerekiyor.
