# Hesabım — /hesap
Son güncelleme: 2026-10-11 · API token bölümü kaldırıldı

## Ne yapar
Oturum açmış kullanıcının kendi ayarları: parola değiştirme, iki adımlı doğrulama (TOTP + kurtarma kodları). API token bölümü dış API ile birlikte 2026-10-11'de kaldırıldı.

## Dosyalar
- Sayfa: `src/app/(panel)/hesap/page.tsx` (65) — yalnız `requireSession()`.
- API:
  - `src/app/api/auth/password/route.ts` POST — kendi parolası (izin yok, oturum yeter)
  - `src/app/api/auth/totp/route.ts` GET/POST/PUT/DELETE/PATCH — `panel.view`; kurulum, doğrulama, kapatma, kurtarma kodları
- Locale: `account.*`, `auth.password.*`, `auth.twoFactor.*`.

## Önemli kararlar ve tuzaklar
- TOTP sırrı `MASTER_KEY` ile şifreli saklanır; anahtar değişirse 2FA çözülemez.
