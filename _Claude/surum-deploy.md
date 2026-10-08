# Sürüm çıkarma ve dağıtım
Son güncelleme: 2026-10-09 · güncel sürüm 1.12.7

## İki ayrı yol
| Yol | Ne zaman | Komut |
|---|---|---|
| **Kullanıcının sunucusuna kaynaktan yükleme** | Her değişiklikten sonra deneme / canlıya alma | `bash deploy.sh` (repo kökünden, Git Bash) |
| **Sürüm yayınlama** (GHCR imajı) | Uzak ajanların güncellenmesi gerektiğinde, ya da yeni sürüm | sürüm yükselt → tag → push |

Merkez panel (192.168.61.114) kaynaktan derlenir (`image: server-panel:local`), GHCR imajını KULLANMAZ. Ajanlar (ör. 192.168.61.107) GHCR imajı kullanır → yeni ajan kodu (yeni op'lar, `runOnce` seçenekleri vb.) ancak sürüm yayınlanınca ajana ulaşır.

## deploy.sh adımları
1. Yerel denetimler: `npm run typecheck`, `npm test`, `npm run i18n:check`, `npm run i18n:scan` (biri düşerse durur).
2. Paket: `src scripts fixtures host-helper package.json package-lock.json Dockerfile .dockerignore next.config.ts tsconfig.json postcss.config.mjs`.
3. Sunucuda yedek: `/home/coraspirin/panel-yedek-<damga>.tgz` (aynı parçalar + `.env`).
4. Yükleme: `src`/`scripts` tamamen değiştirilir; `docker-compose.yml`, `Caddyfile` gibi sunucuya özel dosyalara DOKUNULMAZ; `.env`'de yalnız `APP_VERSION` güncellenir (tekrarlanan satırlar teke iner).
5. `docker compose` ile derle + başlat (`/home/coraspirin/docker/server-panel`).
6. Sağlık: container `healthy` + `APP_VERSION` eşleşmesi + 90 sn sonra son 2 dk loglarda `error|unhandled|ECONN|hata:` yok.

Kurallar: yalnız repo kökünden çalışır (`.deploy-head/` eski bir anlık görüntü — oradan çalıştırma eski kodu yükler). PowerShell'deki `bash` WSL olabilir; betik Git Bash'e geçer. Commit edilmemiş değişiklikler de gider (çıktıda `dirty` görünür).

**Geri alma:** sunucuda `cd /home/coraspirin/docker/server-panel && tar -xzf /home/coraspirin/panel-yedek-<damga>.tgz && docker compose up -d --build`.

## Sürüm yayınlama kontrol listesi
1. Denetimler: `npm run typecheck && npm run lint && npm test && npm run i18n:check && npm run i18n:scan && npm run check:openapi && npm run build`.
2. Sürümü yükselt — **`bash scripts/set-version.sh patch|minor|major`** (ya da `1.13.0`); `--commit` ile "chore: release X" commit'i + `vX` etiketi de atar. Betik şu yerleri birlikte değiştirir ve geride eski sürüm kalırsa uyarır: `package.json`, `package-lock.json`, `Dockerfile` (ARG), `docker-compose.yml` (varsayılanlar), `src/lib/env.ts`, `README.md`, `README_tr.md`, `screenshots/README.md`. PowerShell'den çağrılırsa Git Bash'e geçer (WSL'deki git kimliği yok).
3. Ajan protokolü değiştiyse (`src/lib/agent/protocol.ts` `AGENT_PROTOCOL`, şu an 3): eski ajanlar "uyumsuz" görünür → mutlaka sürüm + ajan güncellemesi.
4. `git push origin main --tags` (commit/etiket betikle atılmadıysa önce elle).
5. `.github/workflows/docker-publish.yml` tag'de çalışır, GHCR'ye amd64 / arm64 / arm/v7 basar. GHCR paketi varsayılan olarak özel olabilir — ajanlar çekemiyorsa paket görünürlüğünü kontrol et.
6. Merkezi `bash deploy.sh` ile güncelle.
7. Ajanlar: panelde **Sunucular → güncelle / hepsini güncelle** (`agent.update` op'u), ya da `agents.auto_update` açıksa heartbeat'te kendiliğinden (etiket başına bir kez). Eski (kendini güncelleyemeyen) ajanlar ya da panelden olmuyorsa: `python agent-deploy.py 192.168.61.107` (ssh, GHCR çeker, `.env` `AGENT_IMAGE` değiştirir, doğrulamazsa geri alır).
8. `_Claude/memory.md`'ye kayıt.

## İlgili dosyalar
`deploy.sh`, `agent-deploy.py`, `.github/workflows/docker-publish.yml`, `.github/workflows/ci.yml`, `src/lib/selfupdate/{index,plan}.ts` (panelin kendini güncellemesi, `/update` sayfası), `src/lib/hosts/agents.ts` (otomatik güncelleme, ajan compose'u), `scripts/docker-entry.mjs`.
