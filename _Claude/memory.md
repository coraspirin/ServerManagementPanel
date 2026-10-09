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
