# Ayarlar — /settings, /settings/[group]
Son güncelleme: 2026-10-08 · commit 428d5e8

## Ne yapar
Tüm panel ayarları gruplar halinde (sekme başına bir grup): genel, izleme, saklama, bildirim, dosyalar, yedek, giriş sayfası… Alan tipleri: metin, sayı, anahtar, cron (insan dili), dizin seçici, host kullanıcısı, container seçici, zengin metin. Yapılandırma dışa/içe aktarma da burada.

## Dosyalar
- Sayfalar: `src/app/(panel)/settings/page.tsx` (ilk gruba `redirect`), `src/app/(panel)/settings/[group]/page.tsx` — `requirePermission("settings.view")`.
- Ekran: `SettingsScreen.tsx` (482), `SettingsTabs.tsx`.
- Bileşenler: `src/components/settings/{ConfigTransfer,CronEditor,ContainerSelect,DirPicker,HostUserSelect,RichTextField}.tsx`.
- API:
  - `src/app/api/settings/route.ts` GET (`settings.view`), PATCH (`settings.edit`)
  - `src/app/api/backup/config/route.ts` GET/POST — yapılandırma dışa/içe aktarma (`settings.edit`)
  - Yardımcı uçlar: `api/host/dirs`, `api/host/users`, `api/docker`
- lib:
  - `src/settings.schema.ts` — TÜM ayarların tek kaynağı: `settingGroups` + ayar tanımları (anahtar, `group`, `section`, `type`, `default`, `min/max`). Ekran bundan otomatik üretilir.
  - `src/lib/settings/index.ts` (397) — çözümleme (`getNumber/getBool/getString`; kaynak ezmesi → global ezme → şema varsayılanı), yazma/doğrulama; `settings/types.ts`.
  - `src/lib/backup/config.ts` — dışa aktarma kapsamı (kurulum ayarları; geçmiş veriler ve SECRET'lar hariç).
  - `src/lib/richtext.ts` — giriş sayfası duyurusu HTML temizleme (oturumsuz sayfada `dangerouslySetInnerHTML` kullanılan tek yer).
  - `src/lib/host/{dirs,users}.ts`.
- Tablo: `settings` (`003_settings.ts`).
- Locale: `settings.*` (grup/alan etiketleri), `cron.editor.*`, `dirPicker.*`, `configTransfer.*`.

## Çoklu sunucu
Ayarlar merkezde; sunucuya özgü olanlar sunucu kapsamlı okunur (`runWithHost` bağlamında `settings` ajana istekle taşınır — `handleRpc` `{settings}`).

## Değişiklik yaparken
Yeni ayar: `src/settings.schema.ts`'e bir tanım (ilke: eşik/aralık/limit/sıklık koda sabit yazılmaz), locale'de etiket/açıklama (`settings.*`). Ayar okuyan kod `getNumber("x.y")` ile okur; migration gerekmez.
