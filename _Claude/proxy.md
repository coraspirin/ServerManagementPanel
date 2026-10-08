# Yayınlama (ters vekil) — /proxy
Son güncelleme: 2026-10-08 · commit 428d5e8

## Ne yapar
Container'ları alan adıyla dışarı açar: Caddy ters vekil kayıtları, sertifika durumu, DDNS (Cloudflare / DuckDNS) ve "Yayını sına" teşhisi (DNS → port → Caddy → hedef erişimi).

## Dosyalar
- Sayfa: `src/app/(panel)/proxy/page.tsx` — `requirePermission("proxy.manage")`; MERKEZİ (Caddy merkezde; uzak hedef `host.address` ile).
- Ekran: `ProxyScreen.tsx` (924).
- API (hepsi `proxy.manage`): `src/app/api/proxy/route.ts` GET/POST, `[id]/route.ts` PATCH/DELETE, `ddns/route.ts` POST/DELETE, `diagnose/route.ts` POST.
- lib:
  - `src/lib/proxy/caddy.ts` — ayrı bir site dosyası üretir, ana `Caddyfile` onu `import` eder; `docker exec caddy reload` (`runOnce`).
  - `src/lib/proxy/store.ts` — kayıtlar + sertifikalar.
  - `src/lib/proxy/ddns.ts` — IP değişince kayıt güncelleme (job).
  - `src/lib/proxy/diagnose.ts`, `reachability.ts` — katman katman teşhis; Caddy ile hedefin aynı Docker ağında olup olmadığı.
- Tablolar: `proxy_hosts`, `certificates`, `ddns_records` (`011_proxy.ts`).
- Repo kökü: `Caddyfile`, `docker-compose.yml` (caddy servisi).
- Locale: `proxy.*`.

## Önemli kararlar ve tuzaklar
- Panel ana Caddyfile'a ASLA yazmaz (panelin kendi girişi orada).
- Yaşanmış olay: hedef container Caddy ile farklı ağdaydı → ad çözülmedi; `reachability.ts` bunu yakalar ve uyarır.
- Sağlayıcılar bilerek az (Cloudflare, DuckDNS).
