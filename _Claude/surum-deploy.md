# Sürüm çıkarma ve dağıtım
Son güncelleme: 2026-10-14 · commit/yayın olmadan Pi ajanına yerel imaj

## İki ayrı yol
| Yol | Ne zaman | Komut |
|---|---|---|
| **Kullanıcının sunucusuna kaynaktan yükleme** | Her değişiklikten sonra deneme / canlıya alma | `bash deploy.sh` (repo kökünden, Git Bash) |
| **Sürüm yayınlama** (GHCR imajı) | Uzak ajanların güncellenmesi gerektiğinde, ya da yeni sürüm | sürüm yükselt → tag → push |

Merkez panel (192.168.61.114) deploy.sh ile SUNUCUDA kaynaktan derlenir (`image: server-panel:local`); CasaOS'un ilk kurduğu GHCR imajı yerine geçer. Ajanlar (ör. 192.168.61.107) GHCR imajı kullanır → yeni ajan kodu ancak sürüm yayınlanınca ajana ulaşır.

## deploy.sh adımları
**Sunucu (2026-10-11 itibarıyla):** 192.168.61.114 artık **ZimaOS** (CasaOS tabanlı; kök dosya sistemi squashfs, SALT-OKUNUR — `/home` dahil; yazılabilir yerler `/DATA`, `/tmp`, `/opt`, `/var/lib/*`). SSH `~/.ssh/config` ile **root**. Panel bir CasaOS uygulaması:
- container `server-management-panel`, servis `server-panel`, port `8081` → 3000
- compose `/var/lib/casaos/apps/compose-75a5218c7cbc9fd0/docker-compose.yml` (dizin adı CasaOS'a özel; deploy.sh container etiketinden bulur)
- veri `/DATA/AppData/server-panel` → `/app/data` (veritabanı, `backups/pre-migration-*.db`) — DOKUNULMAZ
- kaynak (yalnız derleme) `/DATA/AppData/server-panel-src`, yerel imaj `server-panel:local`
- Caddy yok; `HELPER_SECRET` ve host-helper soketi compose'da yok (host işlemleri kapalı). `/DATA/AppData/panel-helper` dizini var ama bağlı değil.

Değiştirilebilir: `PANEL_HOST`, `PANEL_CONTAINER` (varsayılan `server-management-panel`), `PANEL_SRC` (varsayılan `/DATA/AppData/server-panel-src`).

0. Yoklama (salt okunur): container var mı; compose dizini/servis adı `com.docker.compose.project.working_dir` / `com.docker.compose.service` etiketlerinden; şu anki imaj.
1. Yerel denetimler: `npm run typecheck`, `npm test`, `npm run i18n:check`, `npm run i18n:scan`.
2. Paket: `src scripts fixtures host-helper package.json package-lock.json Dockerfile .dockerignore next.config.ts tsconfig.json postcss.config.mjs`.
3. `/tmp`'ye scp → `PANEL_SRC` her seferinde boşaltılıp yeniden açılır (silinen dosyalar kalmasın).
4. Sunucuda `docker build --build-arg APP_VERSION=<sürüm> -t server-panel:local` (önceki yerel imajın kimliği not edilir).
5. CasaOS compose'u `docker-compose.yml.deploy-<damga>.bak` olarak yedeklenir; YALNIZCA servis bloğundaki `image:` satırı `server-panel:local` yapılır (port, veri, MASTER_KEY, kaynak sınırları aynen kalır); `docker compose up -d --pull never <servis>`.
6. Sağlık: `healthy` + `APP_VERSION` eşleşmesi + 90 sn sonra son 2 dk loglarda `error|unhandled|ECONN|hata:` yok; sonra bir önceki yerel imaj silinir (genel `prune` YOK — başka uygulamalara dokunmasın).

Kurallar: yalnız repo kökünden çalışır. PowerShell'deki `bash` WSL olabilir; betik Git Bash'e geçer. Commit edilmemiş değişiklikler de gider (çıktıda `dirty` görünür).

**Geri alma:** sunucuda `cd <compose dizini> && cp docker-compose.yml.deploy-<damga>.bak docker-compose.yml && docker compose up -d server-panel`. ⚠️ Yeni sürüm migration çalıştırdıysa eski imaj yeni şemayla açılmayabilir → önce `/DATA/AppData/server-panel/backups/pre-migration-<n>.db`'yi `panel.db` yerine koy (container durdurulmuşken).

**Dikkat:** CasaOS arayüzünden uygulamayı "güncellemek"/yeniden kurmak compose'u GHCR imajına geri çevirebilir; panelin kendi `/update` ekranı da GHCR'den çeker. Merkezde güncelleme deploy.sh ile yapılmalı.

## Sürüm yayınlama kontrol listesi
1. Denetimler: `npm run typecheck && npm run lint && npm test && npm run i18n:check && npm run i18n:scan && npm run build`.
2. Sürümü yükselt — **`bash scripts/set-version.sh patch|minor|major`** (ya da `1.13.0`); `--commit` ile "chore: release X" commit'i + `vX` etiketi de atar. Betik şu yerleri birlikte değiştirir ve geride eski sürüm kalırsa uyarır: `package.json`, `package-lock.json`, `Dockerfile` (ARG), `docker-compose.yml` (varsayılanlar), `src/lib/env.ts`, `README.md`, `README_tr.md`, `screenshots/README.md`. PowerShell'den çağrılırsa Git Bash'e geçer (WSL'deki git kimliği yok).
3. Ajan protokolü değiştiyse (`src/lib/agent/protocol.ts` `AGENT_PROTOCOL`, şu an 3): eski ajanlar "uyumsuz" görünür → mutlaka sürüm + ajan güncellemesi.
4. `git push origin main --tags` (commit/etiket betikle atılmadıysa önce elle).
5. `.github/workflows/docker-publish.yml` tag'de çalışır, GHCR'ye amd64 / arm64 / arm/v7 basar. GHCR paketi varsayılan olarak özel olabilir — ajanlar çekemiyorsa paket görünürlüğünü kontrol et.
6. Merkezi `bash deploy.sh` ile güncelle.
7. Ajanlar: panelde **Sunucular → güncelle / hepsini güncelle** (`agent.update` op'u), ya da `agents.auto_update` açıksa heartbeat'te kendiliğinden (etiket başına bir kez). Eski (kendini güncelleyemeyen) ajanlar ya da panelden olmuyorsa: `python agent-deploy.py 192.168.61.107` (ssh, GHCR çeker, `.env` `AGENT_IMAGE` değiştirir, doğrulamazsa geri alır).
8. `_Claude/memory.md`'ye kayıt.

## Yayın olmadan ajanı güncellemek (Pi, armv7) — 2026-10-14'te uygulandı
Commit/etiket/GHCR olmadan merkezdeki kod ajana böyle taşındı (Next standalone saf JS, mimariden bağımsız):
1. Merkez `bash deploy.sh` ile güncellenir (`server-panel:local`, amd64).
2. Merkezde: `ID=$(docker create server-panel:local); docker cp $ID:/app - | gzip -1 > /tmp/panel-app-X.tgz; docker rm $ID`.
3. Pi'ye kopyala, `/root/panel-agent-build-X/`'te aç (`app/`), Dockerfile:
   `FROM ghcr.io/coraspirin/servermanagementpanel:1.13.0` → `USER root` → `/app`'i (data hariç) sil → `COPY --chown=1001:1001 app/ /app/` → `ENV APP_VERSION=X` → `USER panel`. `docker build -t panel-agent-local:X .` (Pi 2B'de ~4 dk).
4. `/root/panel-agent/.env` yedeklenir (`.env.manual-X-<damga>`), `AGENT_IMAGE=panel-agent-local:X`, `docker compose -p panel-agent up -d --force-recreate --pull never panel-agent`; 2,5 dk içinde healthy değilse yedek geri konur.
⚠️ Ajan yerel imajdayken merkezin otomatik güncellemesi (`agents.auto_update`) bir sonraki merkez sürümünde GHCR'den o etiketi çekmeye çalışır; etiket yayınlanmadıysa "pull" adımında durur (zararsız, etiket başına bir kez). Kalıcı çözüm: sürümü yayınlayıp normal yola dönmek.

## İlgili dosyalar
`deploy.sh`, `agent-deploy.py`, `.github/workflows/docker-publish.yml`, `.github/workflows/ci.yml`, `src/lib/selfupdate/{index,plan}.ts` (panelin kendini güncellemesi, `/update` sayfası), `src/lib/hosts/agents.ts` (otomatik güncelleme, ajan compose'u), `scripts/docker-entry.mjs`.

## Caddy'siz yapıya geçiş
ZimaOS/CasaOS kurulumunda Caddy hiç yoktu (panel portu doğrudan yayınlanıyor) — geçiş gerekmiyor. Eski Debian kurulumundaki Caddy'li compose artık kullanılmıyor.
