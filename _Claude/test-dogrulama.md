# Test ve doğrulama
Son güncelleme: 2026-10-09

## 1. Yerel denetimler (her değişiklikten sonra)
```bash
npm run typecheck      # tsc --noEmit
npm run lint           # eslint (react-hooks kuralları sıkı: effect içinde senkron setState yasak → async IIFE)
npm test               # node --test "src/**/*.test.ts"
npm run i18n:check     # tr kaynağına göre en/de eksiksiz mi
npm run i18n:scan      # kodda sabit Türkçe metin var mı
npm run check:openapi  # v1 uçları ↔ docs/openapi.yaml
npm run build          # standalone derleme
```
`deploy.sh` ilk dördünü zaten çalıştırır. Bilinen zararsız uyarı: `src/instrumentation.ts:33` Edge runtime `node:crypto`.

## 2. Birim test yazmak
- Dosya: kaynağın yanında `*.test.ts`; `import assert from "node:assert/strict"`, `import { describe, it } from "node:test"`, kaynak **`.ts` uzantısıyla** import edilir (`./parse.ts`).
- Yalnız SAF modüller test edilir: `server-only` ya da `@/` yolu içeren dosyalar `node --test` altında yüklenmez. Bu yüzden mantık saf dosyaya ayrılır (örnekler: `backup/restic.ts`, `security/{ufw,portmap}.ts`, `selfupdate/plan.ts`, `dbadmin/exec/parse.ts`, `docker/listing.ts`, `compose/*`).
- Tek dosya: `node --test --disable-warning=MODULE_TYPELESS_PACKAGE_JSON src/lib/x/y.test.ts`.

## 3. MOCK_MODE ile yerel çalıştırma (Windows'ta Docker yok)
- `.env`: `MOCK_MODE=1`, `MASTER_KEY=<openssl rand -hex 32>`; `npm run dev` → `http://localhost:3000`. Veri `./data/` (`DATA_DIR` ile değişir — denemelerde ayrı bir geçici dizin kullan, gerçek `data/`yı kirletme).
- Sağlayıcılar `fixtures/*.json`'dan sahte veri döner (`docker`, `metrics`, `hardware`, `system`, `tailscale`, `os-updates`, `widgets`). Mock `runOnce` komutu çalıştırmaz (stdout boş).
- Ekran görüntüsü: headless Chrome + CDP betiği (`node shot.mjs <url> <png> [genişlik] [yükseklik] [js]`; Chrome `C:/Program Files/Google/Chrome/Application/chrome.exe`). Betik oturum scratchpad'inde tutuluyor, repoda yok — gerekirse yeniden yaz ya da `scripts/`e taşı.

## 4. Çoklu sunucu (ajan) uçtan uca — yerelde
Merkez `:3123` (ayrı DATA_DIR) + ajan `PANEL_ROLE=agent` `:7443`; ajan tarafında `DOCKER_SOCKET` sahte Docker daemon'una (named pipe) yönlendirilir. Kullanılan yardımcılar (`runagent.mjs`, `fakedocker.mjs`) önceki oturumların scratchpad'indeydi, repoda değil. Locale'ler HEAD sürümünde olmalı.

## 5. Sunucuda deneme (192.168.61.114)
- Bağlantı: `ssh -o BatchMode=yes coraspirin@192.168.61.114` (anahtarla; geliştirme makinesinden).
- Panel imajıyla tek seferlik deneme (geçici container'da çalışacak betikleri doğrulamak için):
  ```bash
  cat betik.sh | ssh coraspirin@192.168.61.114 'cat > /tmp/b.sh; docker run --rm --user 0:0 --network none -v /:/host/root:ro -v /tmp/b.sh:/s.sh:ro --entrypoint sh server-panel:local /s.sh; rm /tmp/b.sh'
  ```
  (Panel imajı `server-panel:local`, container `server-panel-panel-1`, dizin `/home/coraspirin/docker/server-panel`.)
- Panel logu: `docker logs --since 10m server-panel-panel-1`. Sağlık: `docker inspect server-panel-panel-1 --format '{{.State.Health.Status}}'`.
- Uzun Bash komutlarında ters bölü (`\\`) Bash aracında bozulabiliyor → betiği dosyaya yazıp çalıştır.

## 6. Migration'ı bellekte denemek
Python `sqlite3` ile `:memory:` veritabanına önceki migration'ların ilgili `up` SQL'i + örnek satırlar, sonra yeni migration çalıştırılıp sonuç sorgulanır (034 böyle denendi). `up` metni TS dosyasından `` up: ` `` … `` ` `` arası alınır.

## 7. Dağıtım sonrası
`deploy.sh` sağlık kontrolü + elle: ilgili sayfayı aç, ana akışı dene, `docker logs`'ta hata yok. Sonucu `memory.md`'ye ve gerekiyorsa `yapilacaklar.md`'ye yaz.
