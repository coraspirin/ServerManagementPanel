# Denetim kaydı — /audit
Son güncelleme: 2026-10-08 · commit 428d5e8

## Ne yapar
Panelde yapılan her yetkili işlemin (kim, ne zaman, ne yaptı, sonuç) aranabilir listesi. Kullanıcı / eylem / sonuç / tarih aralığı filtresi ve CSV indirme var.

## Dosyalar
- Sayfa: `src/app/(panel)/audit/page.tsx` — `requirePermission("audit.view")`; host kapsamı YOK (kayıtlar merkezde, tüm sunucular için tek tablo).
- Ekran: `src/app/(panel)/audit/AuditScreen.tsx` (307) — filtreler, sayfalama, CSV.
- API: `src/app/api/audit/route.ts` GET — `audit.view`.
- lib: `src/lib/auth/audit.ts` — `audit({...})` yazımı + sorgu. Yazım hatası ana işlemi düşürmez (loglanır, yutulur).
- Tablo: `audit_log` (`src/lib/db/migrations/002_auth.ts`).
- Locale: `audit.*`.

## Veri akışı
Her route handler işlem sonrası `audit({ userId, username, action, targetType, targetId, detail, result })` çağırır → `audit_log`. Ekran `GET /api/audit?…` ile filtreli okur.

## Önemli kararlar ve tuzaklar
- Gizli değer (parola, token) `detail`'e YAZILMAZ — yeni uç eklerken dikkat (ör. `api/database/admin` parolayı yazmaz).
- `action` adları serbest metin (`db.query.write`, `db.admin.create-db`, `backup.*` …); filtre listesi kayıtlardan üretilir.
- Yetkisiz denemeler `result: "denied"` ile yazılır.

## Değişiklik yaparken
Yeni bir eylem için yalnız ilgili route'ta `audit()` çağrısı yeter; şema değişmez.
