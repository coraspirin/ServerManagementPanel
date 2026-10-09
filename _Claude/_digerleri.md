# Panel dışı sayfalar — /, /login, /kiosk, /metrics
Son güncelleme: 2026-10-09 · commit 9989586 (+ ilk kurulum sihirbazı, commit edilmedi)

## / — karşılama sayfası (herkese açık)
- `src/app/page.tsx` (129). Oturumsuz görünen uygulama kartları + duyuru (zengin metin, `src/lib/richtext.ts` ile temizlenir) + sağ üstte giriş düğmesi. Hangi kartların görüneceği `apps` tablosundaki giriş sayfası bayrağı (`024_login_apps.ts`).
- Logolar: `src/app/api/login/logo/**`.

## /login, /login/parola
- `src/app/login/page.tsx`, `LoginForm.tsx`, `src/app/login/parola/page.tsx` (zorunlu parola değişimi).
- API: `src/app/api/auth/{login,logout,2fa,password,totp}/**`.
- lib: `src/lib/auth/{login,session,twofactor,totp,setup}.ts`.
- Kullanıcı yokken `/login` ve `/` → `/kurulum` (aşağıda).

## /kurulum — ilk kurulum sihirbazı
- `src/app/kurulum/page.tsx` + `SetupForm.tsx`. Yalnız `users` boşken açılır, sonra `/login`'e yönlendirir.
- API: `POST /api/auth/setup` `{ code, username, displayName, password }` → ilk yönetici (rol 1, `must_change_pw=0`) + oturum. 403 yanlış kod, 409 kurulu, 429 IP başına 10 hatalı deneme/15 dk (bellekte).
- lib: `src/lib/auth/setup.ts` — `needsSetup()`, `prepareSetupCode()` (açılışta `instrumentation.ts`; kodu üretip loga basar, sha256 özetini `cache` tablosunda `auth:setup-code` anahtarıyla tutar; her açılışta yenilenir), `completeSetup()` (`createUser` + `passwordProblem` kurallarını kullanır, audit `auth.setup`).
- Middleware `PUBLIC_PREFIXES`: `/kurulum`, `/api/auth/setup`.
- `ADMIN_USERNAME`/`ADMIN_PASSWORD` env'leri ve eski `bootstrap.ts` kaldırıldı (bkz. `kararlar.md`).
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
