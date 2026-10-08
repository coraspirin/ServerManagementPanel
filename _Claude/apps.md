# Uygulamalar (kartlar) — /apps
Son güncelleme: 2026-10-08 · commit 428d5e8

## Ne yapar
Ana sayfadaki uygulama kartlarını ve kategorilerini yönetir: kart ekle/düzenle/sırala, logo yükle, Docker etiketlerinden keşif, servis widget'ları (Pi-hole vb.), yer imleri, kiosk bağlantıları (duvar tableti) ve gösterge paneli düzeni.

## Dosyalar
- Sayfa: `src/app/(panel)/apps/page.tsx` — `requirePermission("panel.view")`; düzenleme `apps.manage`.
- Ekran: `AppsScreen.tsx` (696).
- Bileşenler: `src/components/apps/{AppForm,AppTile,categoryIcons}.tsx`, `src/components/home/{BookmarkManager,KioskManager,KioskEditDialog,LayoutEditor}.tsx`.
- API:
  - `src/app/api/apps/route.ts` GET/POST; `[id]/route.ts` PATCH/DELETE; `[id]/move`; `[id]/widget` GET/POST
  - `src/app/api/apps/categories/**`, `apps/discover` POST, `apps/logo` POST, `apps/logo/[file]` GET
  - `src/app/api/bookmarks/**`; `src/app/api/kiosk/route.ts` (`kiosk.manage`)
- lib:
  - `src/lib/apps/store.ts` (695) — kart/kategori CRUD; `types.ts`; `containers.ts` (form için container+port listesi); `discovery.ts` (opt-in `<önek>.enable=true` etiketi); `logos.ts` (`data/logos`).
  - `src/lib/widgets/{index,types,pihole}.ts` — widget kayıt defteri; yeni servis = yeni dosya + diziye ekleme.
  - `src/lib/home/{bookmarks,kiosk}.ts`, `src/lib/dashboard/{catalog,store}.ts`.
- Tablolar: `apps`, `app_categories`, `bookmarks` (`009_launcher.ts`; `024` login, `026` host), `kiosk_tokens` (`010_home.ts`), `kiosk_widgets` (`032`), `dashboard_widgets` (`020`, `031`).
- Locale: `appsScreen.*`, `appForm.*`, `home.*`.

## Önemli kararlar ve tuzaklar
- Keşif OPT-IN: her port yayınlayan container kart olsaydı onlarca çöp kart çıkardı.
- Logolar SQLite'ta değil `data/logos`'ta (WAL/yedek şişmesin).
- Kiosk token'ı URL içinde taşınır (geçmiş/proxy loglarına düşer) — salt-okunur ve iptal edilebilir tutulur.
- Pi-hole widget'ı yalnız v6 API'si.
- Ana sayfanın kendisi: `panel.md`.
