# Panel güncelleme — /update
Son güncelleme: 2026-10-08 · commit 428d5e8

## Ne yapar
Panelin GitHub'daki son sürümünü kontrol eder, değişiklik notlarını gösterir ve tek tuşla günceller (kendini yeniden yaratır). İlerleme ekranda izlenir.

## Dosyalar
- Sayfa: `src/app/(panel)/update/page.tsx` — `requirePermission("panel.update")`; merkez panel için.
- Ekran: `src/app/(panel)/update/UpdateScreen.tsx` (224).
- API: `src/app/api/updates/panel/route.ts` GET (durum/kontrol, `?refresh`), POST (başlat) — `panel.update`.
- lib:
  - `src/lib/selfupdate/index.ts` (404) — akış: sürüm arşivi/imaj indir → docker.sock ile ayrı "updater" container başlat → panel container'ı yeniden yaratılır; sonuç veri dizinine yazılır.
  - `src/lib/selfupdate/plan.ts` (350) — saf parçalar (updater betiği, `IMAGE_UPDATER_SCRIPT`, `.env`/compose yeniden yazma awk'ları); `node --test` ile test edilir.
- Locale: `update.*`.

## Önemli kararlar ve tuzaklar
- İki kurulum tipi: kaynaktan derleme (`image: server-panel:local`, kullanıcının sunucusu böyle) ve GHCR imajı. Imaj modunda compose/`.env`'deki imaj satırı + `APP_VERSION` yeniden yazılır.
- Panel kendi güncellemesinde ölür; bu yüzden işi updater container'ı bitirir.
- Ajanların güncellemesi ayrı: `hosts` sayfası + `agent.update` op'u (bkz. `hosts.md`). Op adları KALICI, `AGENT_PROTOCOL`'e bağlı değil.
- Sürüm 8 yerde geçer: `package.json`, lock, `Dockerfile` ARG, `src/lib/env.ts`, `docker-compose.yml`, 3 README.
- Geliştirme makinesinden elle dağıtım: `bash deploy.sh` (yalnız repo kökünden; `.env` APP_VERSION senkronlanır).
