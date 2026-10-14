# Mimari kararlar
Son güncelleme: 2026-10-13

Bu kararlar bilerek alındı; değiştirmeden önce gerekçeyi oku ve kullanıcıya sor. Yeni karar en üste, biçim: **Karar** — neden · reddedilen alternatif · tarih/kaynak.

## Native ajan ve boş başlangıç (2026-10-13)
Hedef donanım: merkez ZimaOS x86_64 (N150, panel Docker'da, port 8081, kök salt-okunur); uzak ajan Raspberry Pi 2B, DietPi, armv7 (192.168.61.107).

**Native ajan (Faz B)**
- **K1 — Ajan Go ile, tek statik ikili, CGO yok.** Zorunlu hedefler linux/amd64, arm64, armv7. 386 ve armv6 derlenir ama donanımda denenmeden "destekli" denmez. · 2026-10-13
- **Native ajan mevcut `AGENT_PROTOCOL = 3`'ü birebir konuşur** (HTTPS 7443, kendi sertifikası, parmak izi sabitleme, HMAC + nonce + zaman damgası, enrollProof, NDJSON akışlar, `$t` codec'i). Merkezde protokol değişmez; Node ajan ile yan yana çalışabilir. · 2026-10-13
- **K2 — Docker ham Engine API tüneliyle taşınır**: yeni `docker.api` op'u docker.sock'a yalnız izinli endpoint'leri iletir (container, image, volume, network, exec, events, system df; swarm/secrets/plugins/session yasak). Şekillendirme (`docker.live.ts`) merkezde kalır; merkezde `DockerTransport` (yerel = socketPath, uzak = docker.api). · 2026-10-13
- **K2 uygulaması (Faz B adım 2, 2026-10-13)**: `src/lib/docker/transport.ts` (`DockerTransport`, yerel = docker.sock, `bindDockerTransport` ile AsyncLocalStorage bağlama — `docker.live.ts`'in imzaları değişmedi), uzak = `transport.remote.ts` (`docker.api` RPC + `docker.apiStream` akış). İzin listesi saf modülde `src/lib/agent/docker-api-policy.ts`; ortak vektörler `protocol/vectors-v3.json`. Node ajanı iki yolu da sunar (`capabilities.dockerApi/dockerRpc`); **varsayılan eski RPC yolu**, tünel sunucu bazında `agents.docker_transport = api` ile açılır (Pi'de doğrulanınca varsayılan değişir). Native ajan `dockerRpc: false` der → her zaman tünel. **Etkileşimli terminal (exec hijack) tünelden geçmez**: iki yönlü akış RPC/NDJSON'a sığmıyor; uzakta `exec.*` op'ları kalır (native ajan da bunları sunacak). Kullanıcı onayı bekliyor (2026-10-13 rapor). · 2026-10-13
- **K3 — Ajan root çalışır; neyin yapılabileceğine host karar verir** (`/etc/panel-agent/policy.conf`, panel değiştiremez, her istekte yeniden okunur). Dosya işlemleri doğrudan; yol politikası (checkPath) merkezden gelen ayarlarla birebir. · 2026-10-13
- **K4 — host-helper eylemleri Pi için ajana katılır**; ajan ayrı helper gerektirmez. · 2026-10-13
- **K5 — Güncelleme**: merkez yalnız hedef etiketi söyler; ajan kendi mimarisinin ikilisini GitHub Releases'ten indirir. Ed25519 imzalı SHA256SUMS (özel anahtar CI'da, ortak anahtar ajana gömülü), `--selftest`, atomik rename, systemd yeniden başlatma, süresinde sağlıklı bağlanmazsa otomatik geri alma. `agent.update` / `agent.updateStatus` adları ve biçimleri DEĞİŞMEZ. · 2026-10-13
- **Kurulum tek komut** `install-agent.sh --token X --central URL --profile standard` (mimari `uname -m`, ikili indir + doğrula, systemd birimi). Ajan merkeze kendini duyurur (`/api/agent/announce`, bekleyen token'dan türetilmiş HMAC kanıtı, hız sınırlı, token ömrü kısa ~1 sa); panelde "Yeni sunucu bulundu, onayla", onayda mevcut enroll. · Reddedilen: "SSH ile kur". · 2026-10-13
- **Profiller `readonly` / `standard` (varsayılan) / `full`**; güç, root kabuğu ve geri alınamaz işlemler yalnız `full`. Hedefte `panel-agent policy show|profile|allow|deny` ve `panel-agent doctor` (her sorun için düzeltme komutu). · 2026-10-13
- **Pi'ye özgü**: systemd biriminde `After=time-sync.target`; panelde saat sapması "imza geçersiz" yerine "saat farkı: X sn" (agent.hello zamanı); metrik tamponu RAM'de, diske seyrek boşaltılır (SD kart aşınması). · 2026-10-13
- **Faz B karar kapısı**: native ajan kodlamasına Pi ölçümü (docker stats, docker images, free -m, df -h) gelmeden başlanmaz. · 2026-10-13
- **Kapsam dışı (şimdilik)**: merkezi tamamen salt arayüz yapmak (docker.sock'u kaldırmak), Pi'nin merkezi nöbetçi olarak izlemesi, tailscale serve ile HTTPS, canary/bakım penceresiyle güncelleme, yığınları çoklu sunucuya şablonla dağıtma. · 2026-10-13

**Panel tarafı (Faz A)**
- **D1 — Yerel sunucu isteğe bağlı.** Açılışta docker.sock, /host/proc, /host/root'un ÜÇÜ DE yoksa yerel satır (id 1) `enabled=0` yapılır (silinmez) ve "panel kapattı" işareti (`cache` `hosts:local-auto-disabled`) konur; mount'lar sonra gelirse yalnız bu işaret varsa yeniden açılır (kullanıcının elle kapattığına dokunulmaz). Mount'lar varsa davranış aynı. `MOCK_MODE`'da yoklama yok. · Reddedilen: herhangi biri / yalnız docker.sock eksikse kapatmak (kullanıcı seçimi). · 2026-10-13
- **Seçim yerele sessizce düşmez**: yerel devre dışıysa ilk etkin sunucu; hiç yoksa `(panel)/layout.tsx` "İlk sunucunu ekle" ekranı, sunucu isteyen API'ler 409 `noHost`. Bu, 2026-09-24 "Yerel sunucu live sağlayıcıları doğrudan kullanır" kararını yumuşatır (yerel yalnız etkinse kullanılır). · 2026-10-13
- **D6 — Birleşik yetki yönergesi**: `requirePermission` `/yetki-yok?need=<izin>`'e yönlendirir; API 403 yanıtında `need`; `PermissionHint { code, feature, hostId, reason, fix: { where, commands } }` dağınık metinleri (unsupported, actionDisabled, patternDenied, socketMissing, helperMissing, 501) sarar, komutlar host'a özel üretilir. Özellik → gereksinim kataloğu tek dosyada `src/lib/permissions/catalog.ts`. Mevcut `error` alanları korunur (yalnız alan eklenir). · 2026-10-13
- **/kurulum** kodun nerede okunacağını gösterir (`docker logs <container> 2>&1 | grep "Kurulum kodu"`, ZimaOS uygulama günlüğü); kurulum kodu mantığı ve "ADMIN_PASSWORD geri gelmez" kararı aynı. · 2026-10-13
- **Yetki yoklaması** `/hosts`'ta özellik başına ✅/🟡/🔴 + neden + düzeltme komutu; Faz A'da hello capabilities ile, ajan policy bilgisi Faz B'de eklenir. · 2026-10-13

## Sadeleştirme (2026-10-11)
- **Kaldırıldı, kullanıcının isteğiyle**: uygulama kartları + kategoriler + servis widget'ları + yer imleri + hızlı bağlantılar, kiosk, herkese açık karşılama sayfası (`/` artık yalnız yönlendirir → `/panel`), yayınlama (Caddy ters vekil, sertifika, DDNS, teşhis), Tailscale, güvenlik duvarı (ufw) ekranı ve helper eylemleri, dış API (`/api/v1`, API token'ları, `api.manage`, Prometheus `/metrics`). Tablolar 035 ile DROP. Geri getirmek kullanıcıya sorulmadan yapılmaz. · 2026-10-11
- **Caddy tamamen kalktı; panel portu kendisi yayınlar** (`${PANEL_HTTP_PORT}:3000`). İstemci IP'si/şeması için `scripts/docker-entry.mjs` içinde ön katman: Next yalnız loopback'te, ön katman `X-Real-IP`/`X-Forwarded-*`'ı soketten yeniden yazar (uydurulamaz). `PANEL_TRUST_PROXY=1` kullanıcının kendi TLS vekili için. · Reddedilen: Caddy'yi yalnız giriş olarak tutmak (kullanıcı tamamen kaldırmayı seçti); başlıklara koşulsuz güvenmek (rate limit/audit IP'si sahtelenirdi). · 2026-10-11
- **Self-update `Caddyfile`'ı korumaya devam eder** — eski kurulumların compose'u onu bağlıyor olabilir; elle geçiş yapılana dek silinmesin. · 2026-10-11
- **"Kayıtları temizle" yalnız seçili sunucuyu siler**; log imleçleri korunur (eski loglar geri toplanmasın). Log: `settings.edit`, olay: `monitors.manage`. · 2026-10-11

## Dağıtım (ZimaOS)
- **Merkez sunucu ZimaOS/CasaOS; deploy.sh mevcut CasaOS uygulamasını günceller**: kaynak `/DATA/AppData/server-panel-src`'ye yüklenir, imaj SUNUCUDA derlenir (`server-panel:local`), CasaOS compose'unda yalnızca `image:` satırı değişir. Veri klasörüne (`/DATA/AppData/server-panel`) kod konmaz. · Reddedilen: GHCR üzerinden (her yükleme için sürüm yayınlamak gerekirdi), kodu veri klasörüne koymak (veritabanıyla karışır). Kullanıcı seçimi. · 2026-10-11

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
- **Seçili sunucu `AsyncLocalStorage` ile taşınır** (`runWithHost`/`currentHostId`), imzalar değişmez. Yerel sunucu (id 1) live sağlayıcıları doğrudan kullanır. · 2026-09-24 — **2026-10-13 yumuşatıldı (D1)**: yerel isteğe bağlı; devre dışıysa seçilmez, yerine ilk etkin sunucu ya da "İlk sunucunu ekle".
- **Seçim önceliği**: `x-panel-host` başlığı > `?host=` > `panel_host` çerezi > yerel; URL yapısı değişmez. Üst çubukta global seçici. · 2026-09-24
- **Yetenek kapısı**: port edilmemiş uç uzakta 501 + çevrilmiş mesaj; uçlar `{ agent: true }` ile tek tek açılır. · 2026-09-24
- **Yalnız yerel kalanlar**: host cron, fail2ban, LAN taraması/WoL/hız testi/UPnP, zafiyet taraması. Uptime monitörleri merkezi. · 2026-09-24
- **Ajan güncelleme op adları (`agent.update`, `agent.updateStatus`) KALICI**, `AGENT_PROTOCOL`'e bağlanmaz — eski ajanlar da güncellenebilsin. Merkezden ajana imaj aktarma yolu yapıldı ve kullanıcının isteğiyle KALDIRILDI: ajan sürümü kendi kurulumuna göre GitHub/GHCR'den alır. · 2026-10-08

## Güvenlik modeli
- **İlk yönetici tarayıcıdaki `/kurulum` sihirbazıyla oluşur, sihirbaz container logundaki tek kullanımlık kodu ister** — kullanıcı yokken açık sayfayı ağdaki biri kapmasın (Grafana/Jenkins yöntemi); kod her açılışta yenilenir, özeti `cache`'te. · Reddedilen: `ADMIN_PASSWORD` env'i / loga rastgele parola (kullanıcının isteğiyle tamamen kaldırıldı), kodsuz sihirbaz, süre sınırlı sihirbaz. · 2026-10-09
- **Host kökü container'a SALT-OKUNUR bağlı ve öyle kalır**; yazma her zaman yalnız hedef klasörü rw bağlayan geçici container ile. · M3.5
- **Panel container'ı uid 1001**; yetkisiz okuma yalnız izin hatasında root geçici container'a düşer (`docker.sock` zaten root demek, yeni yetki yok). · M3.5
- **Host'ta komut çalıştırma host-helper'dan "rica" ile**; izin listesi host'ta, container'a mount edilmez; panel komut string'i değil preset anahtarı gönderir. · T4 / M1.13
- **Panel fail2ban'a ban EKLEYEMEZ**, yalnız okur/kaldırır. · M3.8
- Gizli değerler `MASTER_KEY` ile şifreli; anahtar değişirse çözülemez (2FA, depo parolaları, bağlantı parolaları). · T3

## Altyapı
- **Job runner Next sürecinin içinde**, ayrı worker yok (standalone çıktı ikinci TS süreci paketlemiyor). · T2
- **Migration'lar TS modülü** (`.sql` değil) — standalone çıktı runtime'da okunan dosyaları kopyalamayabilir. · M0.3
- **Sağlayıcı arayüzleri + live/mock** (`MOCK_MODE`); mock metrik üretici deterministik. · T10
- **`node:sqlite` senkron** → ağır sorgu event loop'u bloklar; özet/sayaçlar hazır kaynaklardan (önbellek, son snapshot) okunur. · T12
- **Metrikler katmanlı** (ham + özet), grafik aralığa göre katman seçer. · T1

## Arayüz ve dil
- **`tr.json` kaynak dil**; diğerleri ondan çevrilir. Makine yeniden çevirisi Türkçeyi bozmuştu (8c8593d) → geri yüklendi; tr.json'ı otomatik çeviriyle değiştirme. Kodda sabit Türkçe metin yok (`i18n:scan`). · 2026-09-25
- **Cron kullanıcıya hiç ham gösterilmez** (sıklık seçici + `cron/friendly.ts`). · M3.45
- **Docker etiketleri opt-out istisna tanımlar** (`panel.hidden`, `panel.update=false`…). · M3.27
- **Uygulama kurulumu Docker sayfasının Yığınlar sekmesine taşındı**; `/appstore` yönlendirme. · 2026-10
