# Servis durumu — /uptime
Son güncelleme: 2026-10-08 · commit 428d5e8

## Ne yapar
Servis monitörleri (HTTP/HTTPS, TCP, ping, DNS, container durumu…): durum çubukları, kullanılabilirlik yüzdesi, elle kontrol, bakım pencereleri.

## Dosyalar
- Sayfa: `src/app/(panel)/uptime/page.tsx` — `requirePermission("metrics.view")`, `pageHostId({ agent: true })`.
- Ekran: `UptimeScreen.tsx` (536); bileşenler `src/components/monitors/{MonitorForm,MaintenanceForm,UptimeBars}.tsx`, `src/components/settings/ContainerSelect.tsx`.
- API:
  - `src/app/api/monitors/route.ts` GET (`metrics.view`), POST (`monitors.manage`) — `{ agent: true }`
  - `src/app/api/monitors/[id]/route.ts` PATCH/DELETE; `[id]/check/route.ts` POST — `monitors.manage`
  - `src/app/api/maintenance/route.ts` GET/POST; `[id]/route.ts` PATCH/DELETE
  - `src/app/api/docker/route.ts` GET — container seçici için
- lib: `src/lib/monitors/check.ts` (sondalar; `node:http(s)` — self-signed için), `run.ts` (tur, job), `store.ts` (kayıt + kullanılabilirlik), `maintenance.ts`, `types.ts`.
- Tablolar: `monitors`, `uptime_log`, `maintenance_windows` (`005_monitors.ts`).
- Locale: `uptime.*`, `monitorForm.*`, `maintenance.*`.

## Çoklu sunucu
Monitörler merkezde çalışır (karar: uptime monitörleri merkezi kalır); liste seçili sunucuya göre filtrelenir. Container tipi monitör ilgili sunucunun Docker'ına sorar.

## Önemli kararlar ve tuzaklar
- Bakım penceresinde kontrol sürer ama durum "bakım" yazılır, kullanılabilirlikten düşülür, bildirim üretmez.
- Olay/bildirim üretimi: `events.md`.
