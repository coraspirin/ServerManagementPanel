# Hesabım — /hesap
Son güncelleme: 2026-10-08 · commit 428d5e8

## Ne yapar
Oturum açmış kullanıcının kendi ayarları: parola değiştirme, iki adımlı doğrulama (TOTP + kurtarma kodları), API token'ları (v1 API için).

## Dosyalar
- Sayfa: `src/app/(panel)/hesap/page.tsx` (65) — yalnız `requireSession()`; token bölümü `api.manage` izni varsa görünür.
- Bileşenler: `src/components/account/PasswordSection.tsx`, `TwoFactorSection.tsx`, `ApiTokenSection.tsx`.
- API:
  - `src/app/api/auth/password/route.ts` POST — kendi parolası (izin yok, oturum yeter)
  - `src/app/api/auth/totp/route.ts` GET/POST/PUT/DELETE/PATCH — `panel.view`; kurulum, doğrulama, kapatma, kurtarma kodları
  - `src/app/api/tokens/route.ts` GET, POST; `src/app/api/tokens/[id]/route.ts` DELETE — `api.manage`
- lib: `src/lib/auth/totp.ts`, `src/lib/auth/twofactor.ts`, `src/lib/auth/apitoken.ts`, `src/lib/apiv1/redact.ts` (Authorization başlığı hiçbir loga girmez).
- Locale: `account.*`, `auth.password.*`, `auth.twoFactor.*`.

## Önemli kararlar ve tuzaklar
- Token değeri yalnız oluşturulduğu an gösterilir; veritabanında hash tutulur.
- TOTP sırrı `MASTER_KEY` ile şifreli saklanır; anahtar değişirse 2FA çözülemez.
- v1 API'nin kendisi: `src/app/api/v1/**`, `src/lib/apiv1/**`, belge `docs/API.md`, `docs/openapi.yaml` (`npm run check:openapi`).
