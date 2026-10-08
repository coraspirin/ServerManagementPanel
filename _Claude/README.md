# Sayfa rehberi — Sunucu Yönetim Paneli
Son güncelleme: 2026-10-09 · commit 428d5e8

Bir sayfa üzerinde çalışmadan önce ilgili dosyayı oku: hangi dosyalar, uçlar, tablolar, ajan op'ları ve kararlar orada. Kod değişince ilgili `.md`'yi de güncelle (tarih + commit satırı dahil).

## Genel rehberler
| Dosya | Ne zaman bakılır |
|---|---|
| [memory.md](memory.md) | İşlem geçmişi (tarih damgalı, en yeni üstte) — her işlemden sonra kayıt eklenir |
| [yapilacaklar.md](yapilacaklar.md) | Açık işler, doğrulanmamış özellikler, bilinen hatalar — iş başında |
| [kararlar.md](kararlar.md) | Mimari kararlar ve gerekçeleri — bir şeyi "düzeltmeden" önce |
| [tarifler.md](tarifler.md) | Yeni sayfa / uç / ajan op'u / migration / ayar / izin / locale / widget / job ekleme |
| [test-dogrulama.md](test-dogrulama.md) | Denetimler, birim test, MOCK_MODE, sunucuda deneme |
| [surum-deploy.md](surum-deploy.md) | `deploy.sh`, sürüm yayınlama, ajan güncelleme, geri alma |
| [veritabani-sema.md](veritabani-sema.md) | Panelin SQLite tabloları, migration'lar, host_id |
| [host-helper.md](host-helper.md) | Host'taki yardımcı daemon: eylemler, güvenlik, kurulum |

## Sayfalar
| Route | Dosya | Kısaca |
|---|---|---|
| `/panel` | [panel.md](panel.md) | Ana sayfa / gösterge paneli, widget'lar, bakım |
| `/apps` | [apps.md](apps.md) | Uygulama kartları, kategoriler, widget, yer imi, kiosk |
| `/docker` | [docker.md](docker.md) | Container, yığın (uygulama kurulumu), image, volume, ağ |
| `/appstore` | [appstore.md](appstore.md) | `/docker?tab=stack`'e yönlendirme; kurulum lib'i |
| `/database` | [database.md](database.md) | Otomatik DB envanteri (Docker/native/SQLite), sorgu, yönetim, dump |
| `/backup` | [backup.md](backup.md) | restic yedekleme v2 (Docker/OS/Veritabanı sistemleri) |
| `/files` | [files.md](files.md) | Host dosya tarayıcısı, disk temizliği |
| `/monitoring` | [monitoring.md](monitoring.md) | Metrik grafikleri, donanım, kapasite tahmini |
| `/uptime` | [uptime.md](uptime.md) | Servis monitörleri, bakım pencereleri |
| `/events` | [events.md](events.md) | Olaylar, bildirim kanalları, zaman çizelgesi |
| `/logs` | [logs.md](logs.md) | Log toplama + FTS arama |
| `/host` | [host.md](host.md) | Servisler, güç, sunucu konsolu (host-helper) |
| `/hostcron` | [hostcron.md](hostcron.md) | Host crontab (yalnız yerel) |
| `/ports` | [ports.md](ports.md) | Dinleyen portlar, sahiplik, boş port |
| `/firewall` | [firewall.md](firewall.md) | ufw (yalnız yerel) |
| `/security` | [security.md](security.md) | SSH anahtarları, fail2ban, UPnP, CVE (Trivy) |
| `/network` | [network.md](network.md) | LAN keşfi, WoL, hız testi, Tailscale (yalnız yerel) |
| `/proxy` | [proxy.md](proxy.md) | Caddy yayınlama, sertifika, DDNS, teşhis |
| `/hosts` | [hosts.md](hosts.md) | Çoklu sunucu / ajanlar, ajan güncelleme |
| `/users` | [users.md](users.md) | Kullanıcı, rol, izin, oturum |
| `/hesap` | [hesap.md](hesap.md) | Parola, 2FA, API token |
| `/audit` | [audit.md](audit.md) | Denetim kaydı |
| `/jobs` | [jobs.md](jobs.md) | Panel arka plan işleri |
| `/settings` | [settings.md](settings.md) | Ayar grupları, yapılandırma aktarma |
| `/update` | [update.md](update.md) | Panelin kendini güncellemesi |
| `/`, `/login`, `/kiosk`, `/metrics` | [_digerleri.md](_digerleri.md) | Panel dışı sayfalar, Prometheus |

## Ortak altyapı (her sayfada aynı, sayfa dosyalarında tekrar edilmez)
- **Yapı**: Next.js 16 (App Router, standalone, Turbopack). Sayfalar `src/app/(panel)/<x>/page.tsx` (sunucu bileşeni, ilk veriyi okur) + `<X>Screen.tsx` (istemci). API `src/app/api/**/route.ts`. İş mantığı `src/lib/**`. Menü `src/lib/nav.ts`.
- **Yetki**: sayfa `requirePermission("x.y")` / `requireSession()` (`src/lib/auth/guard.ts`); uç `guardApi` / `guardHostApi(request, perm, opts)` (`src/lib/auth/api.ts`). İzin anahtarları `src/lib/auth/types.ts`. Yazma işlemleri `audit()` (`src/lib/auth/audit.ts`). İstemci çağrıları CSRF başlığı taşır (`CSRF_HEADER`). `src/middleware.ts` yalnız çerez varlığına bakar.
- **Çoklu sunucu** (ayrıntı `hosts.md`): `guardHostApi(..., { agent: true })` + `enterHost(guard.hostId)`; sayfada `enterHost(await pageHostId({ agent: true }))`. İşaretsiz uç ajan sunucusunda 501; `{ localOnly: true }` yalnız yerel. Host dosya sistemi işi → `onHost("op", args, localFn)` + `src/lib/agent/ops.ts` kaydı. Docker işi → `getDockerProvider()` (kendiliğinden yönlenir; yeni metot `DOCKER_CALLS`'a). `AGENT_PROTOCOL = 3` (`src/lib/agent/protocol.ts`). İstemci: `src/lib/client/host.ts` (`x-panel-host` başlığı, `withHostQuery()`).
- **Sağlayıcılar** (`src/lib/providers/`): `docker|metrics|system|hardware` × `live|mock` + `remote.ts`. `MOCK_MODE=1` ile fixture'larla çalışır.
- **Host'ta iş**: panel container'ı uid 1001, host kökü `/host/root` SALT-OKUNUR. Yükseltilmiş iş = panel imajından geçici container (`runThrowaway`, `panelImage()` `src/lib/host/self.ts`). Komut gerekiyorsa host-helper (`host-helper/panel-helper.py`, `src/lib/host/helper.ts`; izin listesi host'ta).
- **Veritabanı**: `node:sqlite` (senkron), `src/lib/db/client.ts`; migration'lar TS modülü `src/lib/db/migrations/NNN_ad.ts` + `index.ts`'e kayıt (son: `034_dbadmin_inventory.ts`). Gizli değerler `encryptSecret` (`src/lib/crypto.ts`, `MASTER_KEY`).
- **Ayarlar**: tanımlar TEK kaynakta `src/settings.schema.ts` (anahtar, grup, bölüm, tip, varsayılan, min/max; ekran bundan üretilir). Okuma `src/lib/settings/index.ts` (`getNumber/getBool/getString`; sıra: kaynak ezmesi → global ezme → şema varsayılanı). Tablo `settings` yalnız sapmaları tutar.
- **İşler**: `src/lib/jobs/definitions.ts` + `runner.ts` (süreç içi; `src/instrumentation.ts` başlatır).
- **i18n**: düz anahtarlı `src/locales/{tr,en,de}.json`; **tr kaynak**. Sunucu `serverT()` (`src/lib/i18n/runtime.ts`), istemci `useT()` / `useFormat()`; anahtar tipi tr.json'dan türetilir (yanlış anahtar = derleme hatası). Kodda sabit Türkçe metin yasak (`i18n:scan`); zorunluysa satıra `// i18n-ignore`. Locale'leri doğrudan düzenle (anahtar ekleme sırası: aynı önekin sonuna).
- **Ortam**: `MOCK_MODE`, `APP_VERSION`, `PANEL_ROLE` (agent), `MASTER_KEY`, `HOST_ROOT` (`src/lib/env.ts`).

## Denetimler
`npm run typecheck` · `npm run lint` · `npm test` (`src/**/*.test.ts`, node --test) · `npm run i18n:check` · `npm run i18n:scan` · `npm run check:openapi` · `npm run build`

## Dağıtım ve ortam
- Kullanıcının sunucusu: `192.168.61.114`, `/home/coraspirin/docker/server-panel`, kaynaktan derleme (`image: server-panel:local`). Dağıtım: repo kökünden `bash deploy.sh` (Git Bash).
- Ajan: `192.168.61.107` (DietPi, armv7), `agent-deploy.py <IP>`.
- Geliştirme makinesinde Docker yok; sunucu tarafı denemeleri `ssh coraspirin@192.168.61.114` ile.
- Sürüm 8 yerde: `package.json`, lock, `Dockerfile` ARG, `src/lib/env.ts`, `docker-compose.yml`, 3 README.
