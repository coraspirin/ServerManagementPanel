# Olaylar ve zaman çizelgesi — /events
Son güncelleme: 2026-10-11 · "Kayıtları temizle" eklendi (commit edilmedi)

## Ne yapar
Alarm olaylarını (eşik aşımı, çözülme, monitör düştü…) listeler, onaylatır; bildirim kanallarını (Telegram, ntfy, e-posta, webhook…) test eder. "Zaman çizelgesi" sekmesi audit + olay + metrik sıçramalarını tek şeritte birleştirir.

## Dosyalar
- Sayfa: `src/app/(panel)/events/page.tsx` — `requirePermission("metrics.view")`, `pageHostId({ agent: true })`.
- Ekran: `EventsScreen.tsx` (324), `TimelineView.tsx` (318), `EventCenter.tsx` (81; üst çubuk zil menüsü).
- API:
  - `src/app/api/events/route.ts` GET (`metrics.view`), POST onay (`monitors.manage`), DELETE "Kayıtları temizle" (`monitors.manage`, seçili sunucunun tüm olayları, audit `events.clear`) — `{ agent: true }`
  - `src/app/api/timeline/route.ts` GET — `metrics.view`, `{ agent: true }`
  - `src/app/api/notify/test/route.ts` POST — `settings.edit`
- lib: `src/lib/alerts/store.ts` (olaylar; `clearEvents(hostId)`), `alerts/types.ts`, `alerts/engine.ts` + `alerts/conditions.ts` (kural değerlendirme — job), `alerts/announce.ts`, `src/lib/notify/{index,channels,types}.ts`, `src/lib/timeline/index.ts`.
- Tablo: `events` (`006_alerts.ts`). Kanal ayarları `settings` tablosunda `notify.<kanal>.*`.
- Locale: `eventsScreen.*`, `alerts.*`, `timeline.*`.

## Çoklu sunucu
Olaylar `host_id` ile filtrelenir; bildirim başlıkları "[sunucu] …" önekli. Uyarı değerlendirmesi `perHost` job.

## Önemli kararlar ve tuzaklar
- Zaman çizelgesi için YENİ TABLO YOK — üç kaynak sorgu anında birleştirilir.
- Her kanal gönderiminde zaman aşımı zorunlu: yanıt vermeyen servis alarm turunu kilitlememeli.
- Olay temizliği zaman çizelgesinden de siler (çizelge `events`'ten okur); audit kaydı kalır. Onay metni bunu söylüyor.
