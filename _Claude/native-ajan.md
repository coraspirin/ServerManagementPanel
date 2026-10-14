# Native (Go) ajan — `agent/`
Son güncelleme: 2026-10-14 · v1.13.2 ile yayınlandı (ilk native ajan yayını); Pi (host 3) yayından kendini güncelledi

## Ne
Node ajanın (aynı Docker imajı, `PANEL_ROLE=agent`, Pi'de ~124–142 MB RSS, 536 MB imaj) yerini alacak tek statik Go ikilisi (CGO yok, ~7 MB). Host'ta root olarak systemd ile çalışır; neyin yapılabileceğine host'taki politika dosyası karar verir (kararlar.md K1–K5). Merkezle **aynı protokol v3**'ü konuşur — merkezde protokol değişmez, Node ajanla yan yana çalışabilir.

Faz B sırası: ~~DockerTransport + docker.api~~ → ~~adım 3: çekirdek~~ → ~~adım 4: docker tüneli + dosyalar + helper eylemleri (K4)~~ → ~~adım 5: güncelleme + CI + `install-agent.sh`~~ → ~~adım 6: duyuru ucu + profiller + `policy` + `doctor`~~ — hepsi yayınlandı (v1.13.2, 2026-10-14).

## Dosyalar
- `agent/go.mod` — modül `github.com/coraspirin/servermanagementpanel/agent`, yalnız stdlib, Go ≥1.22 (bu bilgisayarda 1.27.2: `%LOCALAPPDATA%\go-sdk\go\bin`, Git Bash'te `export PATH="/c/Users/mucah/AppData/Local/go-sdk/go/bin:$PATH"`; winget bu ortamda takılıyor).
- `agent/cmd/panel-agent/main.go` — `serve` (varsayılan) / `version` / `fingerprint` / `selftest` / `policy` / `doctor`; `-env dosya` (systemd EnvironmentFile biçimi, ortamdaki kazanır; argümanların ARASINDA da olabilir — `extractEnvFlag`, Go'nun flag paketi ilk konumsal argümanda durur). `policy`/`doctor` `-env` verilmezse `/etc/panel-agent/agent.env`'i okur.
- `agent/cmd/panel-agent/cli.go` — `policy show|profile|allow|deny`, `doctor` (gerçek ortam bağlantıları).
- `agent/internal/announce/` — merkeze duyuru (adım 6).
- `agent/internal/doctor/` — kurulum denetimi (ortam işlevleri enjekte edilir, testli).
- `agent/internal/protocol/` — `protocol.go` (imza, `Verify`, `EnrollProof`, parmak izi), `codec.go` (`$t` buf/date/undef ↔ `Bytes`/`Date`/`Undefined`; `Reply`/`Frame` alan sırası Node ile birebir), `vectors_test.go` (`protocol/vectors-v3.json`'u okur).
- `agent/internal/server/` — `server.go` (3 uç, nonce önbelleği, 60 sn'de 20 hata → 429, politika denetimi, NDJSON akış + flush, panic → hata yanıtı), `cert.go` (ECDSA P-256 kendi imzalı, 10 yıl, `cert.pem`/`key.pem` 0600; parmak izi Node `fingerprint256` biçimi).
- `agent/internal/ops/ops.go` — op kaydı (`New`, `Register`, `Names`), `Hello`.
- `agent/internal/hostinfo/` — `system.go` (`SystemInfo`), `metrics.go` (`Sampler`; `metrics.live.ts`'in birebir karşılığı), `hardware.go` (`hardware.live.ts`), `statfs_{linux,other}.go`.
- `agent/internal/policy/policy.go` — `/etc/panel-agent/policy.conf`; `edit.go` — `SetProfile`/`Allow`/`Deny` (yorumları korur, Parse'tan geçmeyen yazılmaz) + atomik `WriteFile`.
- `agent/internal/i18n/` — `strings.json` **üretilir** (`node scripts/agent-strings.mjs`; önek listesi betikte, şimdilik `hardwareLib.`), dil `settings["general.language"]`.
- `scripts/build-agent.sh` (`--all` ile 386/armv6) → `agent/dist/` (gitignore) + `SHA256SUMS`; önce `agent-strings --check`, `go vet`, `go test`.
- `scripts/agent-smoke.ts` — merkezin `protocol.ts`'iyle çalışan bir ajana gerçek TLS istekleri (enroll kanıtı, hello, system.info, metrics, hardware, unknown-op 404, yanlış sır 401). `node scripts/agent-smoke.ts https://ip:7443 <TOKEN>`.

## Yapılandırma (ortam)
`AGENT_TOKEN` (≥32), `AGENT_PORT` 7443, `AGENT_LISTEN` (boş = tümü), `AGENT_DATA` `/var/lib/panel-agent`, `AGENT_POLICY` `/etc/panel-agent/policy.conf`, `REPORTS_DIR` `$AGENT_DATA/reports` (`scripts/hardware.sh` çıktısı), `HOST_PROC`/`HOST_SYS`/`HOST_ROOT_FS` (yalnız deneme; varsayılan `/proc`, `/sys`, `/`). Adım 6: `AGENT_CENTRAL` (panel adresi, duyuru), `AGENT_ANNOUNCE_ADDRESS` (NAT'ta duyurulacak adres; boş = merkeze giden yolun yerel IP'si), `AGENT_SERVICE` (doctor'ın denetlediği systemd birimi, varsayılan `panel-agent`; Pi'de `panel-agent-native`).

## Op'lar
**Adım 4a (2026-10-14, Pi'de doğrulandı)** — `docker.api`, `docker.apiStream`, `exec.start|output|input|resize|close`:
- `agent/internal/docker/policy.go`: izin listesi `docker-api-policy.ts`'in birebir karşılığı. RE2'de ileri bakış olmadığından imaj/volume/ağ ayrılmış ad denetimi kodla (`notReservedImage`, `notCreatePrune`); 47 `check` + 8 `prepare` vektörü + Go'ya özgü test.
- `client.go`: docker.sock HTTP (istek başına bağlantı, havuz yok), ara bellekli `Do` (süre sınırı → `ErrTimeout`), süresiz `Stream`, `Hijack` (Upgrade: tcp, 101/200).
- `exec.go`: oturumlar bellekte, `{out}` çerçeveleri (yarım UTF-8 bir sonrakine taşınır), bitince `{exit}`; boşta kapanma `docker.exec_idle_minutes`; kabuk `docker.exec_shell` ("auto" = bash yoksa sh).
- hello: `docker`/`dockerApi` = soket var mı; `dockerRpc: false` → merkez her zaman tünel kullanır (Docker olayları da `/events` tüneliyle).
- Politika `standard`: `docker.api`, `docker.apiStream`, `exec.*`.
- Pi uçtan uca (merkez API'si, `agent` kullanıcısı): container listesi + istatistik, detay, log SSE, kaynaklar, olaylar (hello-world → 3 olay birer kez), terminal (giriş, boyut, ğüş, `exit 3` → exitCode 3). RSS 13,7 MB.

**Adım 6 (2026-10-14) — duyuru, profiller, `policy`, `doctor`**:
- **Duyuru** (kararlar.md "Kurulum tek komut"): `install-agent.sh --central URL` → `AGENT_CENTRAL`. Ajan açılınca, `$AGENT_DATA/enrolled` yoksa, `POST <central>/api/agent/announce` atar; gövde `{address, port, fingerprint, version, hostname, osName}`, imza RPC ile AYNI (`protocol.Sign`, yol `/api/agent/announce` — yol imzada olduğu için RPC imzası duyuru yerine geçmez). Dakikada bir, 70 dk boyunca (merkez penceresi 60 dk); ilk doğrulanmış merkez isteğinde (`OnVerified`) durur ve `enrolled` işaretini yazar → sonraki açılışlarda duyuru yok. Kurulum yeni sırla yapılırsa işaret silinir.
- Merkez: `src/lib/hosts/announce.ts` `handleAnnounce` (yalnız merkez rolünde; ajan rolünde 404). Bekleyen + sabitlenmemiş + sırrı son 1 saatte üretilmiş satırların (`announceCandidates`) sırlarıyla `verifyRequest` dener; eşleşince duyuru ÖNERİ olarak `hosts.announce`'a (JSON) yazılır, ilk seferde denetim kaydı `hosts.announce` + bildirim (`hosts.announce.notifyTitle|notifyDetail`). Sınırlar: kaynak başına 10 dk'da 20, toplam 200 istek (429); gövde ≤ 4 KB; saat/tekrar hatası doğru sırla gelirse 401 + neden. Sabitleme YAPILMAZ: kullanıcı panelde "Onayla ve bağlan" deyince mevcut enroll (parmak izi kanıtı) çalışır, alan temizlenir. Migration 036 (`token_issued_at`, `announce`). Saf kısım `protocol.ts` `parseAnnounce`, `announceUrl`, sabitler (testli).
- Panel: kurulum penceresi açıkken liste 3 sn'de bir tazelenir; duyuru gelince adres + hostname/sürüm + parmak izi (kurulum çıktısıyla karşılaştırmak için) ve "Onayla ve bağlan"; satırda "Ajan bulundu" düğmesi → bağlan penceresi duyurulan adresle dolu. Kurulum komutuna `--central <tarayıcının panel kökeni>` eklenir (`centralOrigin`: `Origin`, yoksa `x-forwarded-*`/`host`).
- Diller arası doğrulama (Windows): gerçek Go ajanı → panelin `protocol.ts`'iyle doğrulayan deneme merkezi: imza ✓, ayrıştırma ✓, otomatik adres ✓. Gerçek merkezde uçtan uca deneme deploy'dan sonra.
- **Profiller** (kullanıcı onayı 2026-10-14): readonly artık her şeyi OKUR — `docker.api`/`docker.apiStream` yalnız GET/HEAD, `files.list|read|usage|download|cleanupScan`, `host.*`, `updates.osReport`, `backup.scanDir` + helper okumaları. Docker'da GET/HEAD dışı her istek sanal izin **`docker.write`** ister (`ops/docker.go` `writeAllowed`; standard ve full'de açık; standard'da `deny docker.write` → salt okunur Docker). Bozuk/okunamaz politika artık `readonly` değil, listede olmayan `-` profili (yalnız çekirdek) — readonly okuma izni verdiği için yedek olamazdı.
- **`panel-agent policy show`**: dosya, profil, her op (+`docker.write`) için ✔/✖ ve kaynağı (çekirdek / profil / allow / deny satırı), helper eylemleri. **`policy profile <ad>`**, **`policy allow <ad> [desen]`** (aynı ad için deny satırlarını kaldırır), **`policy deny <ad>`** (allow satırlarını kaldırır; çekirdek op reddedilir); desen `#`/satır sonu içeremez ve derlenmeli. Yazımdan sonra `show` basar; ajan yeniden başlatmadan uygular.
- **`panel-agent doctor`**: root mu, `AGENT_TOKEN`, politika, TLS sertifikası + 127.0.0.1:port'taki ajanın sunduğu parmak izi diskteki ile aynı mı, systemd birimi, Docker soketi + `/_ping` (yoksa bilgi), saat eşitlemesi (`timedatectl`; dbus yoksa `systemd-timesyncd` durumu), `AGENT_CENTRAL` varsa merkezin `Date` başlığıyla saat farkı (>5 sn uyarı, >60 sn hata), kayıt durumu (`enrolled`), veri klasörü yazılabilir mi. Her uyarı/hatanın altında düzeltme komutu; hata varsa çıkış kodu 1.
- Güvenlik incelemesi (commit 307c2a9 sonrası): `allow <helper dışı op> <desen>` artık Parse hatası — desen yalnız helper eylemlerinde uygulanıyordu, başka op'ta yok sayılıp op'u TAMAMEN açıyordu. Merkezde ipucu komutları: istekten gelen satırlar (`allowLines`) kontrol karakteri içeriyorsa gösterilmez (`safeConfLines` — satır sonuyla `<<'EOF'` bloğundan kaçıp yöneticinin kabuğunda komut çalıştırılabiliyordu), `echo` satırları `shellQuote` ile.
- ⚠️ AÇIK TASARIM SORUSU (kullanıcıya soruldu): standard profilde merkez fiilen root — `docker.write` (`/containers/create` ile host bind/privileged container) ve `files.*` (kökler merkezin `files.roots` ayarından, `/` olabilir → systemd birimi, cron yazılabilir). policy.conf yalnız dürüst bir merkezi sınırlar. Seçenekler: host tarafında kök sınırı (`root <yol>` yönergesi) + `docker.privileged` ayrımı (privileged/host ağ/cap/host bind yalnız full), ya da mevcut güven düzeyini (K2, Node ajandaki docker.sock ile aynı) belgeleyip bırakmak.
- CLI çıktıları Türkçe sabit (host'taki yönetici terminali, kurulum betiğiyle aynı dil; panel i18n kapsamı dışında).
- Pi'de doğrulandı: `policy show` (24 op + docker.write, 15 helper eylemi), `doctor` (hepsi ✔; politika dosyası yok bilgisi), üretim ajanı yeni ikiliye geçti (`.prev` yedekli), ilk merkez isteğinde `enrolled` yazıldı, panelde çevrimiçi.

**Adım 5 (2026-10-14) — kendini güncelleme, CI, kurulum betiği** (K5):
- `agent/internal/update/`: `agent.update [etiket]` → SHA256SUMS + `.sig` indir, **Ed25519 imzası gömülü ortak anahtarla** (`keys.go` `TrustedKeys`, base64 ham; virgülle birden çok — anahtar değişiminde ikisi birlikte) → kendi mimarisinin ikilisi (`AssetName`: GOARCH + build bilgisindeki GOARM) → özet → `.new` + `selftest` (çıktı = hedef sürüm) → `<ikili>.prev` sakla → atomik yer değiştir → `update/pending.json` (onay son tarihi) → çık (systemd Restart=always yeni sürümü açar). Açılışta `Resume`: deneme sayısı +1; >3 → hemen geri al; değilse son tarihe kadar ilk imzası doğrulanmış merkez isteği (`server.OnVerified` → `Confirm`) gelmezse geri al. Durum `agent.updateStatus` = Node ile aynı `{phase: idle|running|done|failed|rolledBack, tag, detail, at, log}` (`update/state.json`, `update.log`).
- Koşullar: yayın derlemesi (sürüm vX.Y.Z), systemd altında (`INVOCATION_ID`), anahtar var, etiket daha yeni, sürmekte olan yok. `agent.update`/`agent.updateStatus` politikada çekirdek (kapatılamaz; ikili imzalı).
- Deneme ortamı değişkenleri (env dosyası root'a ait): `AGENT_UPDATE_URL`, `AGENT_UPDATE_KEYS`, `AGENT_UPDATE_CONFIRM_SECONDS`. `cmd/servedir` yalnız deneme için klasör sunucusu.
- Yayın: `.github/workflows/agent-release.yml` (vX.Y.Z etiketi; etiket = package.json; `build-agent.sh --all`; `go run ./cmd/release-sign dist/SHA256SUMS` — AGENT_SIGNING_KEY sırrı (PKCS#8 PEM), imzayı gömülü anahtarla hemen doğrular; `install-agent.sh` dahil `gh release upload`). Özel anahtar YALNIZ GitHub sırrında (eklendi 2026-10-14; yerel kopya silindi).
- Kurulum: `scripts/install-agent.sh` (`--token`, `--profile readonly|standard|full`, `--port`, `--version`, `--uninstall`, `--purge`): mimari → indir → imza (OpenSSL 3 `pkeyutl -verify -rawin`, gömülü PEM) + özet + selftest → `/usr/local/bin/panel-agent`, `/etc/panel-agent/{agent.env (0600), policy.conf (yoksa, profile)}`, `/var/lib/panel-agent`, `panel-agent.service` (After=time-sync.target) → enable → parmak izi ve kayıt adresini yazar. Deneme için `PANEL_AGENT_BASE_URL` + `PANEL_AGENT_PUBLIC_KEY`.
- Merkez: "Sunucu ekle" penceresinde önerilen yol native tek komut (`InstallKit.native`, `--version v<merkez sürümü>`), Docker yolu açılır bölümde (`hosts.kit.nativeTitle|nativeHelp|dockerTitle`). Yığın kurulumu native'de 🔴 (`stacks` ops'una `agent.image`).
- Pi'de doğrulandı (geçici, temizlendi): ayrı sınama örneği (7445, kendi systemd birimi, yerel yayın sunucusu, sınama anahtarı) — 1.13.1→1.13.2 güncelleme + onay ✓; 1.13.2→1.13.3 onaysız 60 sn → kendiliğinden 1.13.2'ye GERİ ALMA ✓; kurulum betiği: değiştirilmiş ikili ret ✓, yanlış anahtar ret ✓, readonly profille kurulum + agent-smoke ✓, `--purge` temizliği ✓. Birim testleri: başarı/onay, 6 ret durumu, başlatma koşulları, çökme döngüsü + süre dolumu geri alma (20× tekrarlı; Windows'ta yeniden adlandırma paylaşım ihlali için kısa yeniden deneme eklendi).
- Pi üretim ajanı güncelleyicili ikiliye geçti (hâlâ `/root/panel-agent-native`, birim `panel-agent-native.service`; ilk yayından sonra `install-agent.sh` ile standart yerleşime taşınabilir).
- Açık: güncelleme hata metinleri Türkçe sabit (merkez dili değil) — i18n'e taşınmalı.

**Güvenlik düzeltmeleri (2026-10-14, otomatik güvenlik incelemesi)**:
- Helper deseni artık eyleme özgü argümana uygulanıyor (`subjectKey`: service.*→unit, compose.*→dir, shell.preset→preset, shell.exec→command, fail2ban→jail, cron.list→user). Eskiden "ilk dolu argüman" alınıyordu: `compose.up`'a izinli `unit` + izinsiz `dir` gönderilince desen `unit`'e bakar, komut `dir`'de çalışırdı. **Aynı açık `host-helper/panel-helper.py`'da da vardı** (`ACTION_SUBJECT` ile düzeltildi; host'lardaki helper yeniden kurulana kadar eski davranış sürer). Merkezin ipucu satırı da aynı eşlemeyle (`src/lib/host/helper.ts` `HELPER_SUBJECT`).
- Dosya işlemleri ajanın kendi yollarına `files.roots`'tan bağımsız dokunmaz (`Fs.Protected`: politika klasörü, `/etc/panel-agent`, `AGENT_DATA` (TLS anahtarı), ikilinin ve `-env` dosyasının klasörü (AGENT_TOKEN)); yeniden adlandırma hedefi de denetlenir. Test `TestAjanDosyalariKorunur`.
- Kalan (tasarım gereği, K2): standard profilde `docker.api` `/containers/create` izinli — host bind mount'lu bir container root eşdeğeri; Node ajandaki docker.sock ile aynı güven düzeyi. readonly profil Docker'ı yalnız okur (adım 6, `docker.write`).

**Adım 4c (2026-10-14, Pi'de doğrulandı)** — `helper.call` (K4: ayrı helper daemon'u yok), `agent/internal/helper/`, `ops/helper.go`:
- Eylem tablosu, doğrulayıcılar, zaman aşımları (120 sn / konsol 900 sn + `DEBIAN_FRONTEND=noninteractive`), çıktı sınırları (stdout 100k / stderr 10k karakter) ve **hata metinleri** `panel-helper.py` ile birebir (merkez ipucu eşlemesi "izinli değil"/"desene uymuyor"/"bilinmeyen eylem" parçalarına bakıyor). Uzak süzgeç Node ajanla aynı (`power.`, `service.`, `compose.`, `journal.`, `shell.`). Komutlar kabuksuz (shell.exec hariç).
- İzin: `policy.conf` `allow helper.<eylem> [desen]` (desen allow.conf'taki gibi ana argümana: birim/dizin/kalıp/komut). Açık `allow` satırı olan eylemde karar yalnız o satırlarla; yoksa profil.
- **Profil varsayılanları** (kararlar.md 2026-10-14): readonly = servis durumu/listesi, journal okuma, compose ps/config, cron okuma, fail2ban okuma, salt-okunur kalıplar (disk/bellek/uptime/top/journal hataları/docker df/reboot.required/apt list); standard = readonly + servis başlat/durdur/yeniden başlat, compose up/pull/restart/down, fail2ban unban, `apt.update` kalıbı; **full** = + güç, `shell.exec`, `apt.upgrade|full_upgrade|autoremove`, `docker.prune` (geri alınamaz / root kabuğu).
- hello: `capabilities.helper: true`, `capabilities.helperActions` (politikada açık eylemler).
- Merkez: `HostCapabilities.helperActions`; katalog native sunucuda helper eylemlerini KESİN değerlendirir (hepsi açık ✅, kısmen 🟡, hiçbiri 🔴; yeni ipucu `policyMissing`); ipuçları native'de `policy.conf` satırları (`policyLine`, `permissions.hint.policyConfShould`), başlık `permissions.hint.where.native` (compose klasörü değil). Helper desen reddi compose dışındaysa yeni `argumentDenied` (eskiden "'?' dizininde compose…" diyordu — Node helper'da da aynı hata vardı, düzeldi); `withHint` artık argümanları alıyor.
- Pi uçtan uca (merkez API): service.list, service.status docker, konsol `disk.usage` ✓; `power.cancel`, `shell.exec` → "eylem izinli değil"; `apt.upgrade` kalıbı → desen reddi. (Deploy'daki merkez henüz eski ipucu metinlerini gösteriyor.)

**Adım 4b (2026-10-14, Pi'de doğrulandı)** — `files.list|read|usage|download|mkdir|remove|rename|chmod|write|cleanupScan|cleanupRun`, `host.accounts|listDirs|dirExists`, `updates.osReport`, `backup.scanDir` (`agent/internal/files/`, `ops/files.go`):
- Node'dan farkı: geçici container yok, root olarak doğrudan. **Sembolik bağ denetimi**: izleyen işlemler (okuma, indirme, liste, boyut, chmod, yazma) için çözülmüş gerçek yol da izinli kökte olmalı (`Follow`); girdinin kendisine yapılanlar (silme, yeniden adlandırma) üst klasörün gerçek yoluyla (`Parent`); kök bir bağsa çözülmüş hâli de kök. Hassas dosya (shadow, .env, anahtar) denetimi hem istenen hem çözülmüş yolda. Test `TestSembolikBagKacisi` (Windows'ta atlanır — Pi'de çapraz derlenip koşuldu, geçti).
- `files.remove` klasörü yalnız `recursive` ile siler (yeni metin `fileWrite.isDirectory`); olmayan girdi hata değil (`rm -f`). `files.write` var olan dosyanın izin/sahipliğini korur.
- Temizlik: ajan yalnız host dosyası kalemleri (apt, journald, döndürülmüş loglar); Docker kalemleri native sunucuda MERKEZDE (`src/lib/files/cleanup.ts` `dockerCleanupItems` + `scanCleanup`/`runCleanup` dalı — deploy edilmedi, o zamana kadar native sunucuda Docker temizlik kalemleri görünmez).
- Politika standard'a `files.*`, `host.*`, `updates.osReport`, `backup.scanDir`.
- Pi uçtan uca (merkez API): mkdir/write/read (ğüş)/rename/chmod 0600/liste/indir/usage, `../etc/shadow` reddi, `-r`'siz klasör silme reddi, `-r` silme; `host/users`, `host/dirs`, `files/cleanup`. Geçici klasör `/opt/panel-native-sinama` silindi.
- Node yolundaki benzer açık (yazma için bind edilen üst klasörün bağı host'ta çözülüyordu) 2026-10-14'te kapatıldı: `src/lib/files/write.ts` `realParent` + `resolve.ts` (`files.md`).

**Adım 3 (çekirdek)**
`agent.hello`, `system.info`, `metrics.sample`, `hardware.report`. Dönüş biçimleri `providers/types.ts` ile aynı (alan adları, birimler, ilk `metrics.sample`'da oran metriği yok, boş diziler `[]`). Mimari adı Node'unki (`x64`, `arm`, `arm64`, `ia32`).

`agent.hello.capabilities`: `docker:false, helper:false, hostRoot, reports, dockerApi:false, dockerRpc:false` + EK `native:true`, `ops:[…]` (protokole yalnız alan ekleme; eski merkez yok sayar). Docker/helper adım 4'te açılır.

## Politika (K3 iskeleti)
Satırlar: `profile readonly|standard|full`, `allow <op|önek.*> [desen]`, `deny <…>`, `#` yorum. Sıra deny > allow > profil. Çekirdek op'lar (hello, system.info, metrics.sample, hardware.report, agent.update, agent.updateStatus) her durumda açık. Dosya yok → `standard`; `full` = her şey; profillerin içeriği yukarıda (adım 4c, adım 6). Sanal izin `docker.write`. Bozuk dosya → hata + yalnız çekirdek (`policy-invalid`). Komutla düzenleme: `panel-agent policy …`. mtime/boyut değişince yeniden okunur (yeniden başlatma yok). Ret yanıtı `{ok:false,error:{code:"policy-denied"}}` (HTTP 200).

## Merkez tarafı (bu adımda)
- `protocol.ts` `AgentHello.capabilities` + `HostCapabilities`: `native?`, `ops?`.
- `client.ts` `remoteError`/`replyError`: `unknown-op:` (HTTP 404 + RPC gövdesi) ve `policy-denied|invalid` → `HostError("unsupported")` (501 + yönerge); eskiden 404 tüm sunucuyu "uyumsuz" gösteriyordu. Yeni metin `hosts.errors.policyDenied`.
- `permissions/catalog.ts`: satırlara `ops` (uzakta kullanılan op'lar); `FeatureHost.ops` varsa eksik op → 🔴 `agentOpMissing` (`permissions.hint.agentOpMissing`). `features.server.ts` `caps.ops`'u geçirir.
- `/hosts` satırında "native" rozeti (`hosts.native.badge/help`).

## Pi denemesi (2026-10-14, kullanıcı onayıyla)
- `/root/panel-agent-native/` (ikili + `agent.env` 0600 + `data/` + `pid`), elle `setsid ./panel-agent serve -env agent.env`, port 7444; Node ajan (7443) yerinde. `REPORTS_DIR=/root/panel-agent/reports`.
- Merkeze kullanıcı "pi-native" (host 4) olarak ekledi: online, gecikme 52 ms (Node ajan 223 ms), capabilities `native:true` + 4 op, metrikler 5 sn'de 21 değer.
- Aynı Pi'de Node ajanla karşılaştırma: `system.info` birebir, metrik anahtarları 21/21 aynı (disk etiketleri dahil), donanım raporu aynı biçim.
- Kaynak: Go 9,5 MB boşta / 13 MB bağlıyken, tek çekirdeğin %1,9'u (60 sn); Node ajan 145 MB, %8,8 (o Docker toplamayı da yapıyor — eşit kıyas değil). İkili 7,6 MB.
- Saat: Pi merkezden ~10 sn ileri (60 sn tolerans içinde).
- Bulunan: merkez Docker'ı olmayan sunucuya da olay izleyicisi açıyordu → her turda "ajan uyumsuz" logu. Düzeltme (yerelde, deploy edilmedi): `hostHasDocker`/`dockerHosts` (`hosts/store.ts`) → `events.ts` `watchable`, `docker.collect`/`docker.autoprune`/`updates.images` yalnız Docker'lı sunucularda, `logs/collect.ts` container kısmı atlanır.

## Pi'de kalıcı kullanım (2026-10-14 09:45, kullanıcı kararı)
pi-native (host 4) silindi; host 3 "DietPi" Go ajana taşındı (7443, systemd `panel-agent-native.service`, Node ajan durduruldu, geçmiş korundu). Metrikler 5 sn'de 21 değer. Geri dönüş ve ayrıntı `hosts.md`. Kalıcı yerleşim (`/usr/local/bin`, `/etc/panel-agent/`, `install-agent.sh`) adım 5'te; şimdilik `/root/panel-agent-native/`.

## Tuzaklar
- Kablo biçimi: Go `map` anahtarları alfabetik yazar; yanıt/çerçeve için sıralı `Reply`/`Frame` tipleri kullanılıyor (vektörlerle birebir). Genel değerler `Encode` ile (`SetEscapeHTML(false)`, JS gibi).
- Nesne alanındaki `Undefined` yazılmaz (JS), dizidekiler `{"$t":"undef"}`; `OkReply(Undefined{})` → `{"ok":true}`.
- Windows'ta derlenir/test edilir ama ajan Linux'ta anlamlıdır (`statfs` yalnız linux).
- Yeni ajan metni gerekiyorsa önce `src/locales/*`'e anahtar, sonra `agent-strings.mjs` önek listesi + yeniden üret (`--check` derlemede).
