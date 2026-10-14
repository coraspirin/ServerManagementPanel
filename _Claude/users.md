# Kullanıcılar ve roller — /users
Son güncelleme: 2026-10-13 · /yetki-yok + `?tab=&role=` (commit edilmedi)

## Ne yapar
Panel kullanıcılarını (ekle, düzenle, kilitle, parola sıfırla), rolleri ve rol izinlerini, aktif oturumları yönetir. Üç sekme: kullanıcılar / roller / oturumlar.

## Dosyalar
- Sayfa: `src/app/(panel)/users/page.tsx` — `requirePermission("users.manage")`; host kapsamı yok (merkezi). `?tab=users|roles|sessions` sekmeyi, `?role=<id>` rol kartına kaydırıp vurgular (yetki yönergesindeki "Rolü düzenle").
- **Yetki yönergesi** `src/app/(panel)/yetki-yok/page.tsx` (oturum yeter): `requirePermission` izin eksikse `/yetki-yok?need=<izin>`'e yollar (eskiden `/?forbidden=1`, hiçbir yerde okunmuyordu). `need` `listPermissions()` ile beyaz listeden geçer; gösterilenler: izin + açıklaması, açtığı ekranlar (`permissions/catalog.ts` `featuresForPermission`), bu izne sahip roller (`listRoles()` süzülür), `users.manage` sahibine "Rolü düzenle". Locale `permissions.denied.*`.
- API 403 gövdesi: `{ error, code: "forbidden", need }` (`forbiddenResponse`, `src/lib/auth/api.ts`); CSRF 403'ü `code: "csrf"`. `error` metni aynı (istemci/mobil uyumu).
- Ekran: `src/app/(panel)/users/UsersScreen.tsx` (826).
- API (hepsi `users.manage`):
  - `src/app/api/users/route.ts` GET, POST — liste / oluştur
  - `src/app/api/users/[id]/route.ts` PATCH, POST (parola sıfırlama), DELETE
  - `src/app/api/roles/route.ts` POST; `src/app/api/roles/[id]/route.ts` PATCH, DELETE
  - `src/app/api/sessions/[id]/route.ts` DELETE — oturumu sonlandır
- lib: `src/lib/auth/users.ts` (kullanıcı/rol CRUD, izin kataloğu), `src/lib/auth/session.ts` (oturumlar, `hasPermission`), `src/lib/auth/types.ts` (`PermissionKey` listesi).
- Tablolar: `users`, `roles`, `role_permissions`, `sessions` (`002_auth.ts`, `013_users.ts` alter).
- Locale: `users.*`.

## Önemli kararlar ve tuzaklar
- İzinler kod içinde sabit anahtar listesi (`PermissionKey`); yeni bir özellik yeni izin istiyorsa `auth/types.ts` + varsayılan rol atamaları + locale etiketi birlikte değişir.
- Kendi hesabını silme engellenir (`api/users/[id]/route.ts`); son admin'in rolü düşürülemez/silinemez (`auth/users.ts`, `usersLib.lastAdmin*`).
- "Parola değiştirilmeli" bayrağı girişte `/login/parola`'ya yönlendirir.

## Değişiklik yaparken
İzin eklerken: `src/lib/auth/types.ts`, rol varsayılanları (`auth/users.ts` / migration), `src/locales/*.json` izin etiketi, ilgili `guardHostApi`/`requirePermission` çağrıları.
