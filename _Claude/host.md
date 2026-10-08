# Sunucu (servisler + konsol) — /host
Son güncelleme: 2026-10-08 · commit 428d5e8

## Ne yapar
Host servis işlemleri (yeniden başlatma, kapatma, systemd birimleri, OS güncelleme) ve "Sunucu konsolu": host'ta önceden tanımlı komut kalıplarını (preset) ya da izin verilmiş komutları çalıştırıp çıktısını gösterir. Panel compose dosyası durumu da burada.

## Dosyalar
- Sayfa: `src/app/(panel)/host/page.tsx` — `requirePermission("host.service")`, `pageHostId({ agent: true })`.
- Ekran: `HostScreen.tsx` (336), `ConsolePanel.tsx` (418).
- API (hepsi `{ agent: true }`):
  - `src/app/api/host/route.ts` POST — servis/güç işlemleri (izin işleme göre)
  - `src/app/api/host/console/route.ts` POST — `host.shell`
  - `src/app/api/host/compose/route.ts` GET (`docker.view`), POST (`host.service`)
  - `src/app/api/host/dirs/route.ts` GET — ayarlardaki klasör seçici (`host.listDirs`, `host.dirExists` op'ları)
  - `src/app/api/host/users/route.ts` GET — host kullanıcıları (`host.accounts` op'u)
- lib:
  - `src/lib/host/helper.ts` — host-helper istemcisi (`callLocalHelper`, uzakta `helper.call` op'u, `remoteHelperAllowed`).
  - `src/lib/host/presets.ts` — preset ANAHTARLARI ve etiketleri; komutun kendisi `host-helper/panel-helper.py` → `PRESETS`.
  - `src/lib/host/{dirs,users,self}.ts` — klasör listesi, host hesapları, panelin kendi container/imaj bilgisi (`panelImage()`, `ownImage()`).
  - OS güncellemeleri: `src/lib/updates/os.ts` (`localOsUpdateReport`).
- Host tarafı: `host-helper/panel-helper.py` (daemon; `ACTIONS` tablosu, izin listesi host'ta, imzalı istek, `HELPER_SECRET`).
- Locale: `console.*`, `hostScreen.*`.

## Çoklu sunucu
Uzak sunucuda helper çağrıları ajana `helper.call` ile gider; o sunucuda da host-helper + `HELPER_SECRET` kurulu olmalı.

## Önemli kararlar ve tuzaklar
- Panel host'ta komut ÇALIŞTIRMAZ, helper'dan RİCA eder; izin listesi host'ta, container'a mount edilmez → container ele geçse bile genişletilemez.
- Panel komut STRING'i göndermez; preset anahtarı gönderir, argv'yi host kurar. `presets.ts`'i düzenlemek tek başına yeni komut eklemez — `panel-helper.py`'de de tanımlanmalı.
