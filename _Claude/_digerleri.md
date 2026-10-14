# Panel dışı sayfalar — /, /login, /kurulum
Son güncelleme: 2026-10-13 · /kurulum kod ipucu (commit edilmedi)

## / — kök adres (yalnız yönlendirme)
- `src/app/page.tsx` — kullanıcı yoksa `/kurulum`, oturum varsa `/panel` (zorunlu parola değişimini `(panel)/layout.tsx` yakalar), yoksa `/login`. İçeriği yok.
- Middleware `PUBLIC_EXACT = ["/"]`: middleware DB'ye erişemediği için kurulum kararı sayfaya bırakılır.
- Eski herkese açık karşılama sayfası (kartlar + duyuru) 2026-10-11'de kaldırıldı.

## /login, /login/parola
- `src/app/login/page.tsx`, `LoginForm.tsx`, `src/app/login/parola/page.tsx` (zorunlu parola değişimi).
- API: `src/app/api/auth/{login,logout,2fa,password,totp}/**`.
- lib: `src/lib/auth/{login,session,twofactor,totp,setup}.ts`.
- Kullanıcı yokken `/login` ve `/` → `/kurulum` (aşağıda).

## /kurulum — ilk kurulum sihirbazı
- `src/app/kurulum/page.tsx` + `SetupForm.tsx`. Yalnız `users` boşken açılır, sonra `/login`'e yönlendirir.
- Kodun nerede okunacağı ekranda (2026-10-13): `docker logs <container> 2>&1 | grep "Kurulum kodu"`, container adı için `docker ps --format '{{.Names}}'`, ZimaOS/CasaOS'ta uygulamanın günlükleri. Locale `setup.codeHint|codeContainer|codeZima`. Log satırının biçimi (`  Kurulum kodu : XXXX-…`, `setup.ts`) bu komutla eşleşir — değiştirilirse ipucu da değişmeli.
- API: `POST /api/auth/setup` `{ code, username, displayName, password }` → ilk yönetici (rol 1, `must_change_pw=0`) + oturum. 403 yanlış kod, 409 kurulu, 429 IP başına 10 hatalı deneme/15 dk (bellekte).
- lib: `src/lib/auth/setup.ts` — `needsSetup()`, `prepareSetupCode()` (açılışta `instrumentation.ts`; kodu üretip loga basar, sha256 özetini `cache` tablosunda `auth:setup-code` anahtarıyla tutar; her açılışta yenilenir), `completeSetup()` (`createUser` + `passwordProblem` kurallarını kullanır, audit `auth.setup`).
- Middleware `PUBLIC_PREFIXES`: `/kurulum`, `/api/auth/setup`.
- `ADMIN_USERNAME`/`ADMIN_PASSWORD` env'leri ve eski `bootstrap.ts` kaldırıldı (bkz. `kararlar.md`).
- Oturum çerezi; "beni hatırla" gün, değilse saat (ayar). Kayan pencere yok (bkz. `session.ts` açıklaması).

## Diğer kök uçlar
- `src/app/api/health/route.ts` — sağlık kontrolü.
- `src/app/api/palette/route.ts` — komut paleti araması.
- Dış API (`/api/v1`), API token'ları ve Prometheus `/metrics` 2026-10-11'de kaldırıldı.
- `src/app/api/agent/**` — ajan RPC/stream/enroll (`hosts.md`).
