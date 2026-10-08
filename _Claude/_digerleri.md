# Panel dışı sayfalar — /, /login, /kiosk, /metrics
Son güncelleme: 2026-10-08 · commit 428d5e8

## / — karşılama sayfası (herkese açık)
- `src/app/page.tsx` (129). Oturumsuz görünen uygulama kartları + duyuru (zengin metin, `src/lib/richtext.ts` ile temizlenir) + sağ üstte giriş düğmesi. Hangi kartların görüneceği `apps` tablosundaki giriş sayfası bayrağı (`024_login_apps.ts`).
- Logolar: `src/app/api/login/logo/**`.

## /login, /login/parola
- `src/app/login/page.tsx`, `LoginForm.tsx`, `src/app/login/parola/page.tsx` (zorunlu parola değişimi).
- API: `src/app/api/auth/{login,logout,2fa,password,totp}/**`.
- lib: `src/lib/auth/{login,session,twofactor,totp,bootstrap}.ts`. İlk kurulumda yönetici `bootstrap.ts` ile oluşur.
- Oturum çerezi; "beni hatırla" gün, değilse saat (ayar). Kayan pencere yok (bkz. `session.ts` açıklaması).

## /kiosk/[token]
- `src/app/kiosk/[token]/page.tsx` (111) — oturumsuz, yetki URL'deki token'da (`src/lib/home/kiosk.ts`, tablolar `kiosk_tokens`, `kiosk_widgets`). Yönetimi `/apps` sayfasında (`apps.md`).
- `src/middleware.ts` `/kiosk`'u bilerek açık bırakır (`PUBLIC_PREFIXES`).

## /metrics — Prometheus
- `src/app/metrics/route.ts` — text exposition. Yalnız hazır kaynaklardan (son snapshot, `cache`) beslenir: `node:sqlite` senkron, ağır sorgu event loop'u bloklar. Etiketlerde container ADI (id değil) — kardinalite.

## Diğer kök uçlar
- `src/app/api/health/route.ts` — sağlık kontrolü.
- `src/app/api/palette/route.ts` — komut paleti araması.
- `src/app/api/v1/**` — dış API (token ile; `docs/API.md`, `docs/openapi.yaml`, `npm run check:openapi`).
- `src/app/api/agent/**` — ajan RPC/stream/enroll (`hosts.md`).
