# Veritabanları — /database
Son güncelleme: 2026-10-09 · commit 428d5e8 + commit edilmemiş envanter yeniden yazımı

## Ne yapar
Seçili sunucudaki veritabanlarının OTOMATİK envanteri ve yönetimi:
- **DB sunucuları**: Docker container'ları (postgres/mysql/mariadb/redis imajları) ve host'a kurulu (apt/systemd) MySQL/MariaDB, PostgreSQL, Redis. İçlerindeki veritabanları boyutlarıyla listelenir.
- **SQLite dosyaları**: container volume/bind'larındaki `.db/.sqlite/.sqlite3/.db3` dosyaları (başlık "SQLite format 3" ile doğrulanır), container'a göre gruplu (ör. `defterim → /data/db/defterim.db`).
- Seçilen DB'de: tablolar, Veri / Yapı / SQL sekmeleri, CSV/JSON dışa aktarma, sorgu geçmişi, kayıtlı sorgular.
- Yönetim (MySQL/PostgreSQL sunucuları): DB oluştur (+ isteğe bağlı sahibi kullanıcı), DB sil (ad yazdırarak), kullanıcı oluştur/sil/parola, yetki ver/al (tam / salt okunur), tek DB dökümü `.sql.gz`.
- Elle eklenen bağlantılar (uzak adres, SQLite yolu) "Kayıtlı bağlantılar" altında.

## Dosyalar
- Sayfa: `src/app/(panel)/database/page.tsx` — `requirePermission("db.read")`, `pageHostId({ agent: true })`.
- Ekran: `DatabaseScreen.tsx` (ana; seçim `{connectionId, database}`), `InventoryTree.tsx` (sol ağaç), `AdminModals.tsx` (kimlik / yeni DB / kullanıcılar), `api.ts` (`call`, `generatePassword`).
- API `src/app/api/database/` (hepsi `{ agent: true }`):
  - `route.ts` GET `mode=inventory|tables|structure` + liste (`db.read`); POST `test|credentials|writable|save-query|delete-query|create` (`db.write`); PATCH, DELETE. `database` sorgu parametresi bağlantının DB'sini geçersiz kılar.
  - `query/route.ts` POST — `db.read`; yazan SQL ayrıca `db.write` + bağlantının "yazılabilir" bayrağı.
  - `admin/route.ts` POST — `db.write`; `users|create-db|drop-db|create-user|drop-user|set-password|grant|revoke`; yalnız envanter (docker/native) bağlantıları; parolalar audit'e yazılmaz.
  - `dump/route.ts` GET — `db.read`; akışlı `.sql.gz`, audit'li.
- lib `src/lib/dbadmin/`:
  - `index.ts` — koruma katmanı (salt-okunur, limit, tehlikeli ifade onayı) + yönlendirme: `transport` docker/native ise `exec` yolu (MERKEZDE), tcp/sqlite ise sürücü (`onHost("db.*")` ile ajanda).
  - `store.ts` — `db_connections` (+ `upsertInstance`, `pruneInstances(keys, scannedPrefixes)`, `setInstanceCredentials`, `setWritable`), geçmiş, kayıtlı sorgular (host filtreli).
  - `types.ts` — `DbConnection` (`transport`, `instanceKey`, `meta`), `InventoryInstance`, `InventoryDatabase` (SQLite'ta `connectionId`, `path`), `DbUser`.
  - `sql-guard.ts`, `discovery.ts` (`engineOf`: imaj adı → motor; exporter/admin/backup imajları elenir).
  - `drivers/network.ts` (pg, mysql2, el yazımı RESP; tablo/yapı sorguları `RawRunner` ile hem sürücü hem exec'te ortak), `drivers/sqlite.ts` (okuyamazsa root geçici container).
  - `exec/runner.ts` — docker: `runOnce(container, sh -c …, {env})` ile container'ın kendi `mysql/psql/redis-cli`'ı; native: panel imajından geçici container, soket bind, `networkMode: host`. SQL `PANEL_SQL` env'de → stdin. MySQL native kimlik sırası: elle girilen → root unix_socket → `debian.cnf`. Postgres native: host'taki `postgres` uid'iyle peer. `dumpPlan` (gzip|base64 satırları).
  - `exec/inventory.ts` — `buildInventory()`: docker + native + sqlite taraması paralel; satırları upsert eder; DB listesi + boyut; hatalar `errors[]`'da (yutulmaz).
  - `exec/native.ts` — `/host/root` altında soket/systemd taraması (`db.native` ajan op'u).
  - `exec/sqlite-scan.ts` — tüm container bağlarını tek root geçici container'da `find` + başlık kontrolü; gürültü filtresi (backups/cache/_old/trivy); dosya sahibi = en dar bağ.
  - `exec/admin.ts` — DDL; ad beyaz listesi + tırnaklama; MySQL GRANT'ta `_`/`%` kaçışı.
  - `exec/parse.ts` (+ `parse.test.ts`) — `mysql --batch`, `psql --csv`, psql komut etiketi.
- Tablolar: `db_connections` (`016`, `026` host_id, `034_dbadmin_inventory.ts`: `transport`, `instance_key`, `meta_json`, eski içe aktarılanlar docker'a taşındı), `db_query_history`, `db_saved_queries` (`016`).
- Ajan op'ları: `db.query/tables/structure/test/read` (tcp/sqlite), `db.native`. Docker işleri sağlayıcı proxy'siyle.
- Dockerfile: `mariadb-client postgresql-client redis-tools` (native erişim için).
- Locale: `database.*`, `dbadmin.*`, `dbStore.*`, `dbDriver.*`, `api.db.*`.

## Envanter satırları (`db_connections`)
| Tür | instance_key | transport | host | ad |
|---|---|---|---|---|
| Docker DB sunucusu | `docker:<container>` | docker | container adı | `@<hostId>:<key>` |
| Native | `native:mysql:<soket>` / `native:postgres:<port>` / `native:redis:6379` | native | soket ya da 127.0.0.1 | `@<hostId>:<key>` |
| SQLite dosyası | `sqlite:<host yolu>` | tcp (sürücü) | dosya yolu | `@<hostId>:<key>` |
| Elle | boş | tcp | kullanıcı girer | kullanıcı girer |
`name` tablo genelinde UNIQUE (016) → envanter satırlarına benzersiz iç ad; arayüz etiketi container/servis adından.

## Önemli kararlar ve tuzaklar
- Neden exec: eskiden içe aktarılan container'a ad ile TCP bağlanılıyordu, ajan ayrı Docker ağında → ENOTFOUND. Native DB'ler loopback'te ve panel container'ında `127.0.0.1` host değil.
- Eski ajan: `runOnce` env'i yok sayar → betik exit 97 / `stdout` alanı yok → "ajan eski" mesajı (`dbadmin.agentOutdated`). Native'de exit 127 (istemci yok) aynı mesaj.
- Yeni envanter satırı salt-okunur başlar; yazma bayrağı SQL editörünü korur, yönetim işlemleri ayrı (`db.write` + onay).
- Döküm: Docker'da DB'nin kendi imajıyla (`networkMode: container:<db>`); native'de panel imajındaki pg_dump 15 → daha yeni native PG sunucusunun dökümü reddedilir.
- Yedekleme modülü kullanıcı adı boş envanter satırlarını kimlik kaynağı saymaz (`backup/discover.ts`, `backup/sources.ts`).
- Durum (2026-10-09): commit edilmedi; sunucuda yalnız SQLite tarama betiği denendi (0,4 sn, Defterim bulundu). Tam akış deploy sonrası doğrulanmalı.

## Değişiklik yaparken
Yeni motor: `types.ts` (`DbEngine`, etiket/port), `discovery.ts` deseni, `runner.ts` istemci betiği + `clientInvocation`, `inventory.ts` `listDatabases`, `parse.ts`. Denetim: `npm run typecheck && npm run lint && npm test && npm run i18n:check && npm run i18n:scan`.
