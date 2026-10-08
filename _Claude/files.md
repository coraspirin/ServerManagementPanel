# Dosyalar — /files
Son güncelleme: 2026-10-08 · commit 428d5e8

## Ne yapar
Host dosya sistemi tarayıcısı: gezinme, önizleme/düzenleme, yükleme/indirme, klasör oluşturma, yeniden adlandırma, silme, chmod, klasör boyutu analizi. "Disk temizliği" asistanı kalem kalem ne kadar yer kazanılacağını gösterip onaylı temizler.

## Dosyalar
- Sayfa: `src/app/(panel)/files/page.tsx` (64) — `requirePermission("files.read")`, `pageHostId({ agent: true })`.
- Ekran: `FilesScreen.tsx` (735).
- API:
  - `src/app/api/files/route.ts` GET (`files.read`), POST (`files.write`) — `{ agent: true }`
  - `src/app/api/files/cleanup/route.ts` GET (tara), POST (temizle)
- lib:
  - `src/lib/files/paths.ts` — TEK yol doğrulama girişi; `hostRoot()` (`/host/root`).
  - `src/lib/files/browse.ts` — okuma (salt-okunur bağdan doğrudan).
  - `src/lib/files/elevated.ts` — panel (uid 1001) okuyamazsa root geçici container (panel imajı).
  - `src/lib/files/write.ts` — her yazma yalnız hedef klasörü rw bağlayan geçici container'da.
  - `src/lib/files/cleanup.ts` — temizlik taraması/çalıştırma.
- Ajan op'ları: `files.list/read/usage/download/mkdir/remove/rename/chmod/write/cleanupScan/cleanupRun` (`src/lib/agent/ops.ts`).
- Locale: `filesScreen.*`.

## Çoklu sunucu
Her işlem `onHost("files.*")` ile seçili sunucuda; indirme akış op'u.

## Önemli kararlar ve tuzaklar
- Host kökü container'a SALT-OKUNUR bağlı ve öyle kalmalı; yazma her zaman geçici container ile.
- `/home/coraspirin` 750 → panel doğrudan göremez, yükseltilmiş okuma gerekir.
- Temizlikte "hepsini temizle" düğmesi BİLEREK yok; her kalem ayrı onay + audit.
- Docker container içi dosya tarayıcısı ayrı: `src/lib/docker/files.ts` (bkz. `docker.md`).
