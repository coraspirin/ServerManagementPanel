# Yapılacaklar ve açık konular
Son güncelleme: 2026-10-14

Kural: biten maddeyi sil (ya da "Kapananlar"a taşı) ve `memory.md`'ye kayıt düş. Yeni açık iş / bilinen hata buraya eklenir. Bir madde ile çalışmadan önce burada ve ilgili sayfa rehberinde güncel durumu kontrol et.

## Commit / dağıtım bekleyenler
- [ ] **1.13.1 (Faz A + Faz B adım 2 + 2 düzeltme)** — commit edildi (2026-10-14, main; push/etiket yok); merkez ve Pi'de çalışıyor, doğrulandı. Pi yerel imajda (`panel-agent-local:1.13.1`) → push + etiket + GHCR yayını yapılınca normal yola dönmeli.
- [ ] **Repoda silinmiş görünen deploy paketleri**: `panel-deploy-20261011-1758.tgz` / `-1809.tgz` (cfbacd3'te yanlışlıkla commit edilmiş); silinmeleri commit'e alınmadı — kullanıcı kararı. `.gitignore`'a `panel-deploy-*.tgz` eklenebilir.
- [ ] **docker.api tüneli**: merkezden canlıda liste/istatistik/olay yolları doğrulandı (Pi, ~5 dk), sonra ayar varsayılana (rpc) alındı. Ekran işlemleri (arşiv, pull, runOnce, geçici container) tünelde henüz denenmedi — `test-dogrulama.md` §4b.
- [ ] **v1.13.0 imajı kendini 1.12.7 bildiriyor** (etiketteki Dockerfile `ARG APP_VERSION` güncellenmemiş). `set-version.sh` bugün Dockerfile'ı da değiştiriyor; sürüm yayınında CI'ın `APP_VERSION` build-arg'ını etiketten vermesi daha sağlam (`docker-publish.yml`).
- [ ] **Faz B adım 2 — docker.api tüneli** (2026-10-13): kod + vektörler commit edildi (2026-10-14). Pi'de doğrulama `test-dogrulama.md` §4b (yeni ajan sürümü gerekiyor → yayın/agent-deploy kullanıcı onayıyla). Doğrulanınca `agents.docker_transport` varsayılanı yeniden değerlendirilecek.
- [ ] **Faz B — native Go ajanı** (`native-ajan.md`): adım 3–6 yazıldı (2026-10-14, commit edilmedi); Pi (host 3) native ajanda (adım 6 ikilisi). `AGENT_SIGNING_KEY` sırrı eklendi; profil varsayılanları onaylandı (2026-10-14). Açık işler: merkez değişiklikleri deploy edilmedi; `db.*` ve compose dosyası yazma (yığın kurulumu, `agent.image` yerine) native'de yok; güncelleme metinleri i18n; Pi standart yerleşime (`install-agent.sh`) ilk yayından sonra; duyuru gerçek merkezde uçtan uca deploy'dan sonra denenmeli (`test-dogrulama.md` §4d); katalog readonly profilde Docker yazma özelliklerini hâlâ ✅ gösterir (hello'da `docker.write` bilgisi yok — istenirse eklenir). Faz B adımları bitti.
- [ ] **Pi native ajanda (2026-10-14)**: host 3 Go ajanında, Docker/dosya/log/yedek adım 4'e kadar yok. Merkez deploy edilene kadar günlükte `[docker-events] DietPi: … uyumsuz` tekrarlar (düzeltme yerelde: `hostHasDocker`). Geri dönüş `hosts.md`.
- [ ] **Saat dilimi düzeltmesi** (2026-10-14, `settings.md`): commit/deploy edilmedi. Deploy sonrası zamanlamalar fiilen 3 saat erkene (yazıldıkları yerel saate) kayar — kullanıcıya hatırlat. Arayüzde MOCK dev'le gözle denenmedi.
- [ ] **Veritabanı envanteri** (2026-10-08/09, `database.md`) — commit edildi (f4d23b6), sunucuya deploy edilmedi. Deploy sonrası doğrulanacak: Docker DB'leri (paperless-db postgres, paperless-redis) listede ve boyutlu; SQLite grupları (defterim, vaultwarden, pihole…); tablo gezme, sorgu; test DB oluştur → kullanıcı + salt-okunur yetki → dump (`gunzip` ile kontrol) → sil.
- [ ] **Yeni sürüm yayınlama** — ajanlarda envanterin çalışması için gerekli (`runOnce` env seçeneği, `db.native` op'u, imajdaki DB istemcileri). Bkz. `surum-deploy.md`.

- [ ] **Sadeleştirme** (2026-10-11): uygulamalar/kiosk/karşılama/proxy+Caddy/Tailscale/güvenlik duvarı/dış API kaldırıldı, log/olay temizleme eklendi — commit edildi (5d6d314, cfbacd3), deploy edilmedi.
- [x] ~~deploy.sh (ZimaOS/CasaOS sürümü)~~ — sunucuda tam çalıştı (2026-10-14, 1.13.1; şema v35).
- [ ] **CasaOS compose'unda `PANEL_HTTP_PORT` yok** — panel yayın portunu 8080 sanıyor (gerçek: 8081); yalnız yığın kurulumundaki "panelin kendi portu" uyarısını etkiler. CasaOS uygulama ayarından `PANEL_HTTP_PORT=8081` eklenebilir.
- [ ] **`.env.example`** — okuma izni engelli olduğu için güncellenmedi: `PANEL_HTTPS_PORT`, `PANEL_SITE_ADDRESSES`, Caddy/Tailscale/Proxy açıklamaları temizlenmeli; `PANEL_TRUST_PROXY` eklenmeli.

## Doğrulanmamış özellikler
- [ ] **Yedekleme v2** (`backup.md`): sunucuda gerçek restic koşusu (yedekle → geri yükle → doğrulama) yapılmadı; yalnız MOCK_MODE'da ekran testi.
- [ ] **Ajanın kendini güncellemesi** (`hosts.md`, commit 428d5e8): uçtan uca denenmedi (panelden `agent.update` → ajan GHCR'den çeker → yeniden başlar). Eski ajanlar bir kez elle güncellenmeli (`agent-deploy.py`).
- [ ] **Uzak ajanda (192.168.61.107, armv7) veritabanı sayfası** — yeni sürümden sonra.

## Eksik / yarım işler
- [ ] **Yedekleme**: "ilk kurulumda yedekten geri yükle" (v2 planındaki ek #6) yapılmadı. İndirme yalnız yerel sunucuda.
- [ ] **SQLite dosyaları**: döküm/indirme yok (yalnız sunucu motorlarında).

## Bilinen sınırlamalar / hatalar
- Native PostgreSQL ≥16 dökümü başarısız: panel imajındaki `pg_dump` 15 (Debian bookworm). Çözüm seçeneği: PGDG deposundan `postgresql-client-17` (armhf desteği kontrol edilmeli).
- `next build` uyarısı: `src/instrumentation.ts:33` `node:crypto` Edge runtime uyarısı — derlemeyi durdurmuyor, önceden var.
- Uzak sunucuda "Sunucu" sayfası (`host.md`) için o sunucuda host-helper + `HELPER_SECRET` kurulu olmalı.
- `/home/coraspirin` 750 → panel (uid 1001) bazı yolları yalnız yükseltilmiş okumayla görür (normal, bkz. `files.md`).

## Kapananlar
(henüz yok)
