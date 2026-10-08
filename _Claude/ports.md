# Portlar — /ports
Son güncelleme: 2026-10-08 · commit 428d5e8

## Ne yapar
Sunucuda dinleyen portları sahipleriyle (süreç / container / compose servisi) listeler, çakışmaları gösterir ve verilen aralıkta boş port bulur.

## Dosyalar
- Sayfa: `src/app/(panel)/ports/page.tsx` — `requirePermission("security.view")`, `pageHostId({ agent: true })`.
- Ekran: `src/app/(panel)/ports/PortsScreen.tsx` (323).
- API: `src/app/api/ports/route.ts` GET — `security.view`, `{ agent: true }`.
- lib:
  - `src/lib/security/ports.ts` (298) — toplama: `/proc/net/*` + `/proc/<pid>/fd` okunur (ss/netstat yok).
  - `src/lib/security/portmap.ts` (415) — saf: sahiplik zinciri, boş port, çakışma (testli).
- Locale: `ports.*`.

## Veri akışı
Toplama panel imajından geçici container'da yapılır: `networkMode: host` (host'un /proc/net'i), `pidMode: host` + `SYS_PTRACE` (soket inode → süreç eşlemesi). Sonuç önbelleğe yazılır; ekran yaşını gösterir.

## Çoklu sunucu
Ajanlı sunucuda geçici container ajanın Docker'ında açılır (sağlayıcı proxy'si).

## Önemli kararlar ve tuzaklar
- İki ad alanı sorunu: `/proc/net` ağ ad alanına, `/proc/<pid>/fd` PID ad alanına bağlı — ikisi de host olmalı.
- `ss` sürüm farkları kolon düzenini değiştirdiği için kullanılmıyor.
