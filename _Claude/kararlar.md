# Mimari kararlar
Son güncelleme: 2026-10-09

Bu kararlar bilerek alındı; değiştirmeden önce gerekçeyi oku ve kullanıcıya sor. Yeni karar en üste, biçim: **Karar** — neden · reddedilen alternatif · tarih/kaynak.

## Veritabanı yöneticisi
- **Keşfedilen DB'lere ağdan değil "exec transport" ile erişilir** (Docker: container'ın kendi istemcisi `docker exec`; native: panel imajından geçici container + host soketi) — ajan ayrı Docker ağında olduğu için ad çözülmüyordu (ENOTFOUND), native DB'ler loopback'te. · Reddedilen: panel/ajanı DB ağlarına `connectNetwork` ile bağlamak (ağ yapısını değiştirir, native'i çözmez). · 2026-10-08
- **Exec yönlendirmesi merkezde**, ajana yeni op yalnız dosya sistemi taraması için (`db.native`) — sağlayıcı proxy'si zaten seçili sunucuya gider. · 2026-10-08
- **SQL istemciye `PANEL_SQL` ortam değişkeniyle, stdin'den gider** — parola içeren DDL `ps`'te görünmesin, argv sınırı yok. · 2026-10-08
- **Envanter satırları `db_connections`'ta, benzersiz iç adla (`@<hostId>:<key>`)** — `name UNIQUE` kısıtı tablo yeniden kurulmadan kalkmıyor; yeniden kurmak FK CASCADE ile geçmişi silerdi. · 2026-10-08
- **Yeni bağlantılar salt-okunur başlar**; SQL editöründe yazma = `db.write` izni + bağlantının "yazılabilir" bayrağı (çift kapı). Yönetim işlemleri (DB/kullanıcı) bayrağa bakmaz, `db.write` + açık onay ister. · M3.6 / 2026-10-08
- **SQLite dosyası adına değil içeriğine (ilk 15 bayt) göre tanınır.** · 2026-10-08

## Yedekleme (v2)
- **restic kalır; restic host'a kurulmaz, her komut geçici container'da.** · M3.4
- **Üç sistem işi (Docker / İşletim Sistemi / Veritabanı) sunucu başına bir tane**; eski elle işler `custom` ("Özel işler") ve `/data` yolunu korur (önceki snapshot parent olsun). · 2026-10-08
- **Sistem başına ayarlar yedek ekranında**, Ayarlar sayfasında değil; kullanıcı yol/ad yazmaz (otomatik keşif + işaretleme). · 2026-10-08
- Reddedilenler: ikinci kopya (3-2-1), ayrı `backup.view` izni. · 2026-10-08
- **Geri yükleme varsayılanı "yeni klasöre çıkar"**; yerine yazma ad yazdırılarak onaylanır. · 2026-10-08

## Çoklu sunucu
- **Ajan = aynı Docker imajı, `PANEL_ROLE=agent`**; ayrı kod tabanı yok (sürüm uyumu kendiliğinden). · 2026-09-24
- **Ajan yalnız I/O yapar, mantık merkezde**; kapalı op listesi (`src/lib/agent/ops.ts`). Veritabanı, `MASTER_KEY`, şifreler ajana gitmez (bağlantı parolası istekle gelir, saklanmaz). · 2026-09-24
- **Seçili sunucu `AsyncLocalStorage` ile taşınır** (`runWithHost`/`currentHostId`), imzalar değişmez. Yerel sunucu (id 1) live sağlayıcıları doğrudan kullanır. · 2026-09-24
- **Seçim önceliği**: `x-panel-host` başlığı > `?host=` > `panel_host` çerezi > yerel; URL yapısı değişmez. Üst çubukta global seçici. · 2026-09-24
- **Yetenek kapısı**: port edilmemiş uç uzakta 501 + çevrilmiş mesaj; uçlar `{ agent: true }` ile tek tek açılır. · 2026-09-24
- **Yalnız yerel kalanlar**: host cron, ufw/fail2ban, LAN taraması/WoL/hız testi/UPnP, zafiyet taraması, Tailscale. Proxy/Caddy ve uptime monitörleri merkezi. · 2026-09-24
- **Ajan güncelleme op adları (`agent.update`, `agent.updateStatus`) KALICI**, `AGENT_PROTOCOL`'e bağlanmaz — eski ajanlar da güncellenebilsin. Merkezden ajana imaj aktarma yolu yapıldı ve kullanıcının isteğiyle KALDIRILDI: ajan sürümü kendi kurulumuna göre GitHub/GHCR'den alır. · 2026-10-08

## Güvenlik modeli
- **Host kökü container'a SALT-OKUNUR bağlı ve öyle kalır**; yazma her zaman yalnız hedef klasörü rw bağlayan geçici container ile. · M3.5
- **Panel container'ı uid 1001**; yetkisiz okuma yalnız izin hatasında root geçici container'a düşer (`docker.sock` zaten root demek, yeni yetki yok). · M3.5
- **Host'ta komut çalıştırma host-helper'dan "rica" ile**; izin listesi host'ta, container'a mount edilmez; panel komut string'i değil preset anahtarı gönderir. · T4 / M1.13
- **ufw kural söz dizimi host tarafında doğrulanır**; serbest metin geçmez. · M3.7
- **Panel fail2ban'a ban EKLEYEMEZ**, yalnız okur/kaldırır. · M3.8
- **API token'ı tek başına kimlik** → `Authorization` hiçbir loga girmez; token'a `docker.exec`/`host.shell` asla verilmez. · T12
- Gizli değerler `MASTER_KEY` ile şifreli; anahtar değişirse çözülemez (2FA, depo parolaları, bağlantı parolaları). · T3

## Altyapı
- **Job runner Next sürecinin içinde**, ayrı worker yok (standalone çıktı ikinci TS süreci paketlemiyor). · T2
- **Migration'lar TS modülü** (`.sql` değil) — standalone çıktı runtime'da okunan dosyaları kopyalamayabilir. · M0.3
- **Sağlayıcı arayüzleri + live/mock** (`MOCK_MODE`); mock metrik üretici deterministik. · T10
- **`node:sqlite` senkron** → Prometheus `/metrics` yalnız hazır kaynaklardan beslenir. · T12
- **Metrikler katmanlı** (ham + özet), grafik aralığa göre katman seçer. · T1

## Arayüz ve dil
- **`tr.json` kaynak dil**; diğerleri ondan çevrilir. Makine yeniden çevirisi Türkçeyi bozmuştu (8c8593d) → geri yüklendi; tr.json'ı otomatik çeviriyle değiştirme. Kodda sabit Türkçe metin yok (`i18n:scan`). · 2026-09-25
- **Cron kullanıcıya hiç ham gösterilmez** (sıklık seçici + `cron/friendly.ts`). · M3.45
- **Keşifler opt-in** (uygulama kartı: `<önek>.enable=true` etiketi); Docker etiketleri opt-out istisna tanımlar. · M2.5 / M3.27
- **Uygulama kurulumu Docker sayfasının Yığınlar sekmesine taşındı**; `/appstore` yönlendirme. · 2026-10
- **Karşılama sayfası (/) herkese açık**, kart başına açık işaret olmadan hiçbir kart gösterilmez. · 2026-08-21
