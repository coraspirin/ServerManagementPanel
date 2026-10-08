# Uygulama mağazası — /appstore
Son güncelleme: 2026-10-08 · commit 428d5e8

## Ne yapar
Sayfa artık yalnız bir yönlendirme: `/docker?tab=stack`'e gider (uygulama kurulumu Docker sayfasının "Yığınlar" sekmesine taşındı; `stacksMoved.*` notu). Kurulum mantığı ve API'si duruyor.

## Dosyalar
- Sayfa: `src/app/(panel)/appstore/page.tsx` — `requirePermission("apps.install")`, `pageHostId({ agent: true })`, `redirect("/docker?tab=stack")`.
- API: `src/app/api/appstore/route.ts` GET, POST — `apps.install`, `{ agent: true }`.
- lib:
  - `src/lib/appstore/install.ts` (457) — compose yaz (root geçici container) → `compose config` doğrula → `compose up` (host-helper).
  - `src/lib/appstore/preflight.ts` — "Kur"dan önce çalışacak mı kontrolü (yaşanmış olay: helper `compose.up` argüman desenini reddetti).
  - `src/lib/compose/{checks,ports,service}.ts` — saf: ön kontroller (engel/uyarı/öneri), port söz dizimi, `yaml` Document API ile yorumları koruyan düzenleme.
  - Port çakışması için `src/lib/security/{ports,portmap}.ts`.
- Tablo: `app_stacks` (`018_appstore.ts`, `026` host_id).
- Locale: `stacksMoved.*`, `appstore.*`, `compose.*`.

## Önemli kararlar ve tuzaklar
- Yazma ve çalıştırma ayrı yeteneklerle: dosya root container ile, `docker compose` host-helper ile (CLI eklentisi imajda yok).
- Asıl arayüz için `docker.md` → Yığınlar.
