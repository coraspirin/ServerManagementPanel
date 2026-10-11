# Ağ — /network
Son güncelleme: 2026-10-11 · Tailscale kaldırıldı

## Ne yapar
LAN cihaz keşfi (IP, MAC, üretici, son görülme), Wake-on-LAN, hız testi (geçmişle). (Tailscale bölümü 2026-10-11'de kaldırıldı.)

## Dosyalar
- Sayfa: `src/app/(panel)/network/page.tsx` — `requirePermission("network.manage")`; YALNIZ YEREL.
- Ekran: `NetworkScreen.tsx` (438); bileşenler `src/components/network/SpeedtestSection.tsx`.
- API (hepsi `network.manage`, `{ localOnly: true }`): `src/app/api/network/route.ts` GET/POST/DELETE, `speedtest/route.ts` GET/POST, `wol/route.ts` POST/DELETE.
- lib:
  - `src/lib/network/scan.ts` — TCP bağlantı denemesi + host ARP tablosu (ham ARP yok, `arp-scan` yok).
  - `src/lib/network/oui.ts` — MAC → üretici; IEEE listesi `data/oui.csv`'ye indirilir (imaja gömülmez).
  - `src/lib/network/wol.ts` — sihirli paket elle; yayın Docker köprüsünden LAN'a ulaşmaz, bu yüzden hedef adres ayarı önemli.
  - `src/lib/network/speedtest.ts` — Cloudflare ölçüm uçları (speedtest-cli/Ookla yok).
- Tablolar: `network_devices` (`012_network.ts`), `wol_devices`, `speedtest_results` (`009_launcher.ts`).
- Locale: `networkScreen.*`, `speedtest.*`.

## Önemli kararlar ve tuzaklar
- Panel container'ı LAN'da değil Docker köprüsünde; keşif ve WoL bu kısıta göre tasarlandı.
- Uzak sunucu seçiliyken sayfa gizlenir (localOnly kararı, `multi-host` planı).
