# Test ve doğrulama
Son güncelleme: 2026-10-13

## 1. Yerel denetimler (her değişiklikten sonra)
```bash
npm run typecheck      # tsc --noEmit
npm run lint           # eslint (react-hooks kuralları sıkı: effect içinde senkron setState yasak → async IIFE)
npm test               # node --test "src/**/*.test.ts"
npm run i18n:check     # tr kaynağına göre en/de eksiksiz mi
npm run i18n:scan      # kodda sabit Türkçe metin var mı
npm run build          # standalone derleme
```
`deploy.sh` ilk dördünü zaten çalıştırır. Bilinen zararsız uyarı: `src/instrumentation.ts:33` Edge runtime `node:crypto`.

## 2. Birim test yazmak
- Dosya: kaynağın yanında `*.test.ts`; `import assert from "node:assert/strict"`, `import { describe, it } from "node:test"`, kaynak **`.ts` uzantısıyla** import edilir (`./parse.ts`).
- Yalnız SAF modüller test edilir: `server-only` ya da `@/` yolu içeren dosyalar `node --test` altında yüklenmez. Bu yüzden mantık saf dosyaya ayrılır (örnekler: `backup/restic.ts`, `security/portmap.ts`, `selfupdate/plan.ts`, `dbadmin/exec/parse.ts`, `docker/listing.ts`, `compose/*`).
- Tek dosya: `node --test --disable-warning=MODULE_TYPELESS_PACKAGE_JSON src/lib/x/y.test.ts`.

## 3. MOCK_MODE ile yerel çalıştırma (Windows'ta Docker yok)
- `.env`: `MOCK_MODE=1`, `MASTER_KEY=<openssl rand -hex 32>`; `npm run dev` → `http://localhost:3000`. Veri `./data/` (`DATA_DIR` ile değişir — denemelerde ayrı bir geçici dizin kullan, gerçek `data/`yı kirletme).
- Sağlayıcılar `fixtures/*.json`'dan sahte veri döner (`docker`, `metrics`, `hardware`, `system`, `os-updates`). Mock `runOnce` komutu çalıştırmaz (stdout boş).
- Ekran görüntüsü: headless Chrome + CDP betiği (`node shot.mjs <url> <png> [genişlik] [yükseklik] [js]`; Chrome `C:/Program Files/Google/Chrome/Application/chrome.exe`). Betik oturum scratchpad'inde tutuluyor, repoda yok — gerekirse yeniden yaz ya da `scripts/`e taşı.

- **Boş başlangıç / yetki yönergesi (2026-10-13)**: `MOCK_MODE=1 MOCK_HOSTS=2 DATA_DIR=<geçici>` ile; `PATCH /api/hosts/1 {"enabled":false}` (MOCK'ta mount denetimi yok) → varsayılan mock-2; mock-2'yi de kapat → sunucu isteyen sayfalar `/ilk-sunucu`'ya 307, `/api/docker` 409 `noHost`. Sayfa İÇİNDEKİ `redirect()` akış başladıktan sonra 200 + `NEXT_REDIRECT` döner (curl'de gövdeye bak). İzinsiz kullanıcı: hazır `izleyici` rolü (id 3) `users.manage`'siz → `/users` → `/yetki-yok?need=users.manage`, `GET /api/users` 403 `need`. Mount yoklaması yalnız `local-probe.test.ts` ile sınanır.

## 4. Çoklu sunucu (ajan) uçtan uca — yerelde
Merkez `:3123` (ayrı DATA_DIR) + ajan `PANEL_ROLE=agent` `:7443`; ajan tarafında `DOCKER_SOCKET` sahte Docker daemon'una (named pipe) yönlendirilir. Kullanılan yardımcılar (`runagent.mjs`, `fakedocker.mjs`) önceki oturumların scratchpad'indeydi, repoda değil. Locale'ler HEAD sürümünde olmalı.

## 4b. docker.api tünelini Pi'de doğrulama (Faz B adım 2)
Ön koşul: merkez yeni kodla (deploy.sh) ve Pi'deki Node ajanı aynı sürümle (yayın + `agent-deploy.py`) — ikisi de kullanıcı onayıyla. Pi'ye bu bilgisayardan `ssh root@192.168.61.107` (anahtar 2026-10-13'te eklendi).
1. `/hosts` → Pi'nin yetenekleri: `GET /api/hosts` yanıtında `capabilities.dockerApi: true`.
2. Ayarlar → Güncellemeler → Ajanlar → "Uzak Docker erişim yolu" = **Ham API tüneli**, kapsam yalnız Pi.
3. Pi seçiliyken: Docker listesi + istatistik, container detay/inspect, log (takip dahil), başlat/durdur, imaj çek (akış), imaj geçmişi, volume/ağ listesi, `system df`, temizlik, dosya arşivi oku/yaz, veritabanı envanteri (runOnce = exec create/start), yedekleme geçici container'ı (runThrowawayStream), olaylar (bir container'ı yeniden başlat → /events'te kayıt), terminal (exec.* — tünelden bağımsız).
4. Pi'de ölç (baz: 142 MB RSS, ~%12 CPU): `ps -eo pid,rss,pcpu,etime,args --sort=-rss | head -5`, 3× `docker stats --no-stream`, ağ sayaçları. Merkez günlüğünde `docker-api-denied` olmamalı (olursa `docker-api-policy.ts`'e eksik kural).
5. Geri dönüş: ayarı **Ajandaki sağlayıcı** yap (anında, yeniden başlatma yok).

## 4c. Native (Go) ajanı denemek (Faz B adım 3)
- Yerelde (Windows, veri boş ama protokol tam): `cd agent && go build -o <scratch>/panel-agent.exe ./cmd/panel-agent`; `AGENT_TOKEN=<48 hex> AGENT_DATA=<scratch>/data AGENT_LISTEN=127.0.0.1 AGENT_PORT=17443 AGENT_POLICY=<scratch>/policy.conf ./panel-agent.exe` → `node scripts/agent-smoke.ts https://127.0.0.1:17443 <token>` (2026-10-14: 8/8).
- Pi'de (kullanıcı onayıyla): `agent/dist/panel-agent-linux-armv7` → `/root/panel-agent-native/`, Node ajanın YANINDA `AGENT_PORT=7444`, ayrı token, `AGENT_DATA=/root/panel-agent-native/data`; merkezden aynı sınama betiği; merkeze "pi-native" olarak eklenip izleme/donanım sayfası; ölçüm `ps -o rss,pcpu`. Bitince süreç ve sunucu kaydı kaldırılır.

## 4d. Native ajan duyurusu, `policy`, `doctor` (Faz B adım 6)
- Duyuru diller arası (Windows): `go build -o <scratch>/panel-agent.exe ./cmd/panel-agent`; scratch'te küçük bir Node HTTP sunucusu panelin `src/lib/agent/protocol.ts`'ini `pathToFileURL` ile içe aktarıp `verifyRequest` + `parseAnnounce` uygular; ajan `AGENT_CENTRAL=http://127.0.0.1:<port> AGENT_TOKEN=… AGENT_DATA=<scratch>/data AGENT_LISTEN=127.0.0.1 AGENT_PORT=… serve` ile başlatılır → ilk duyuru hemen gelir (2026-10-14 ✓). Deneme verisi (TLS anahtarı) sonra silinir.
- Gerçek merkezde (deploy sonrası): Sunucular → Sunucu ekle → komuttaki `--central` adresi uzak sunucudan erişilebilir olmalı → kurulum → pencerede "Ajan bulundu" (≤ 1 dk) → parmak izini kurulum çıktısıyla karşılaştır → Onayla ve bağlan.
- Pi'de: `panel-agent policy show -env /root/panel-agent-native/agent.env`, `AGENT_SERVICE=panel-agent-native panel-agent doctor -env …` (2026-10-14 ✓). Politika değiştiren komutları üretim dosyasında denemeyin; geçici `AGENT_POLICY=/tmp/x.conf` verin.

## 5. Sunucuda deneme (192.168.61.114, ZimaOS)
**Sunucu (2026-10-11 itibarıyla):** 192.168.61.114 artık **ZimaOS** (CasaOS tabanlı; kök dosya sistemi squashfs, SALT-OKUNUR — `/home` dahil; yazılabilir yerler `/DATA`, `/tmp`, `/opt`, `/var/lib/*`). SSH `~/.ssh/config` ile **root**. Panel bir CasaOS uygulaması:
- container `server-management-panel`, servis `server-panel`, port `8081` → 3000
- compose `/var/lib/casaos/apps/compose-75a5218c7cbc9fd0/docker-compose.yml` (dizin adı CasaOS'a özel; deploy.sh container etiketinden bulur)
- veri `/DATA/AppData/server-panel` → `/app/data` (veritabanı, `backups/pre-migration-*.db`) — DOKUNULMAZ
- kaynak (yalnız derleme) `/DATA/AppData/server-panel-src`, yerel imaj `server-panel:local`
- Caddy yok; `HELPER_SECRET` ve host-helper soketi compose'da yok (host işlemleri kapalı). `/DATA/AppData/panel-helper` dizini var ama bağlı değil.
- Bağlantı: `ssh -o BatchMode=yes 192.168.61.114` (config'teki root; `coraspirin@` ile anahtar REDDEDİLİR, tekrarlanan denemeler bağlantı kesilmesine yol açtı).
- Panel imajıyla tek seferlik deneme (geçici container'da çalışacak betikleri doğrulamak için):
  ```bash
  cat betik.sh | ssh 192.168.61.114 'cat > /tmp/b.sh; docker run --rm --user 0:0 --network none -v /:/host/root:ro -v /tmp/b.sh:/s.sh:ro --entrypoint sh server-panel:local /s.sh; rm /tmp/b.sh'
  ```
- Panel logu: `docker logs --since 10m server-management-panel`. Sağlık: `docker inspect server-management-panel --format '{{.State.Health.Status}}'`.
- Uzun Bash komutlarında ters bölü (`\\`) Bash aracında bozulabiliyor → betiği dosyaya yazıp çalıştır.

## 6. Migration'ı bellekte denemek
Python `sqlite3` ile `:memory:` veritabanına önceki migration'ların ilgili `up` SQL'i + örnek satırlar, sonra yeni migration çalıştırılıp sonuç sorgulanır (034 böyle denendi). `up` metni TS dosyasından `` up: ` `` … `` ` `` arası alınır.

## 7. Dağıtım sonrası
`deploy.sh` sağlık kontrolü + elle: ilgili sayfayı aç, ana akışı dene, `docker logs`'ta hata yok. Sonucu `memory.md`'ye ve gerekiyorsa `yapilacaklar.md`'ye yaz.
