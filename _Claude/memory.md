# İşlem kaydı

Projede yapılan her işlem buraya, EN YENİ EN ÜSTTE olacak şekilde tarih damgasıyla eklenir.

Biçim:
```
## YYYY-MM-DD HH:MM — kısa başlık
- Ne yapıldı / neden
- Değişen dosyalar (önemliler)
- Durum: commit edildi mi, test/deploy edildi mi, açık kalanlar
```

---

## 2026-10-14 22:40 — v1.13.2 yayınlandı: ilk native ajan yayını, merkez deploy, Pi kendini güncelledi
- CI logu (`gh auth login` sonrası): agent-release v1.13.1'de `TestHataMetinleriMerkezleUyumlu` düştü — test `power.cancel`'ı gerçekten çalıştırıyordu, runner'da `shutdown` vardı. Düzeltme `helper.commandPath` (+ `hint.ts` `#` filtresi) → commit `5a27d1d`; `set-version.sh patch --commit` → `67b99be` + `v1.13.2`; push.
- İş akışları v1.13.2: agent-release ✓ (5 ikili, SHA256SUMS + .sig, install-agent.sh), Docker imajı ✓, CI ✓. İmza bağımsız doğrulandı (OpenSSL, gömülü anahtar).
- `deploy.sh` → merkez 1.13.2 sağlıklı; Pi native ajanı otomatik güncellemeyle v1.13.2'yi indirdi, imza/özet/selftest → yeniden başladı → merkez onayı (`state.json` done, `.prev` yedek). deploy.sh, bu 5 sn'lik `ECONNREFUSED` yüzünden 1 döndü; önceki panel imajı (`37a4942591b8`) elle silindi.
- v1.13.1 etiketi kaldı (GHCR imajı var, GitHub yayını yok). `note.txt` ve `host-helper/__pycache__/` commit dışı.

## 2026-10-14 17:20 — Push + v1.13.1 etiketi; agent-release başarısız (neden bilinmiyor)
- `15c59cd` (güvenlik düzeltmeleri) commit; `main` push; `v1.13.1` etiketi push. Merkez `15c59cd` ile yeniden deploy (sağlıklı).
- İş akışları: CI main/v1.13.1 ✓, Docker imajı main/v1.13.1 ✓ (GHCR 1.13.1), **agent-release ✖ "Derle (vet + test dahil)" adımında**. Loglar `gh` oturumu olmadan okunamıyor.
- Elenenler: Go 1.22 vet (windows + linux/amd64 + linux/arm) ✓; Go 1.22 testler Pi'de root ve `nobody` ✓; `golang:1.22` container'ında uid 1001 vet+test ✓ (sunucuda geçici, imaj ve klasör silindi); etiketteki ağaçla `agent-strings --check` ✓; `-count=15` ve tek çekirdek + yük altında kararsız test yok.
- Commit edilmemiş: `hint.ts` `#` içeren ipucu satırı filtresi (yorum çapayı düşürüp izni genişletirdi; güvenlik incelemesi) + test.
- Sıradaki: kullanıcı `gh auth login` yaparsa log okunup iş yeniden çalıştırılacak.

## 2026-10-14 16:41 — Commit 307c2a9, merkez deploy, güvenlik incelemesi düzeltmeleri
- Commit `307c2a9` (native ajan, saat dilimi, duyuru, güvenlik düzeltmeleri; `note.txt` ve `host-helper/__pycache__/` dahil edilmedi). `bash deploy.sh` → merkez 1.13.1 sağlıklı, migration 036 uygulandı (`pre-migration-36.db`), loglar temiz, iki sunucu çevrimiçi, `/api/agent/announce` imzasız isteğe 401.
- Arka plan güvenlik incelemesi 4+1 bulgu: (1) `hint.ts` ipucu komutlarında satır sonuyla heredoc kaçışı → `safeConfLines` + `shellQuote` (+test); (2) policy: helper dışı op'ta desen yok sayılıp op tamamen açılıyordu → Parse reddi (+test); (3) Docker `/containers/create` ile host kaçışı ve (4) merkez kontrollü `files.roots` → standard profilde merkez fiilen root: tasarım sorusu, kullanıcıya soruldu (`native-ajan.md`, `yapilacaklar.md`).
- Testler: Node 592/592, typecheck, lint, i18n; Go tümü.

## 2026-10-14 16:27 — Faz B adım 6: ajan duyurusu, profil ayrıntısı, `policy` ve `doctor` komutları
- Merkez: `POST /api/agent/announce` (`src/lib/hosts/announce.ts`, oturumsuz, yalnız merkez rolü; RPC imzası + bekleyen satırın sırrı, sır üretiminden 1 sa, kaynak başına 20/10 dk, toplam 200) → `hosts.announce` önerisi + denetim kaydı + bildirim; migration 036 (`token_issued_at`, `announce`; bellekte 001–036 denendi); `protocol.ts` `parseAnnounce`/`announceUrl`/sabitler (+3 test); `HostView.announce`; kurulum komutuna `--central <köken>` (`centralOrigin`); Sunucular ekranı: kurulum penceresinde 3 sn yoklama + "Ajan bulundu" kutusu (parmak izi) + "Onayla ve bağlan", satırda "Ajan bulundu" düğmesi. Yeni metinler `hosts.announce.*`, `hosts.kit.nativeHelp` (tr/en/de).
- Ajan: `internal/announce` (dakikada bir, 70 dk, `enrolled` işaretiyle biter; yerel adres UDP "dial"), `internal/doctor` (token, politika, sertifika + dinleyen parmak izi, systemd, Docker ping, NTP/timesyncd, merkez saat farkı, kayıt, veri klasörü; düzeltme komutlarıyla), `policy/edit.go` + `cli.go` (`policy show|profile|allow|deny`), `-env` argümanların arasında da (`extractEnvFlag`). Profiller: readonly her şeyi okur (Docker GET/HEAD, dosya okuma op'ları), sanal `docker.write`; bozuk politika → `-` profili (yalnız çekirdek). `install-agent.sh --central` (AGENT_CENTRAL; yeni sırda `enrolled` silinir; çıktıda doctor/policy).
- Doğrulama: Node typecheck/lint/test 591/591/i18n/build; Go vet + tüm testler (announce, doctor, policy edit, env bayrağı yeni); diller arası duyuru (Go ajan → `protocol.ts` doğrulayıcı) ✓. Pi: `policy show`, `doctor` ✓ (bulunan iki hata düzeltildi: `-env` konumu, koşullu op'lar listede yoktu; dbus'sız NTP denetimi eklendi); üretim ajanı yeni ikiliye geçti (`.prev`), `enrolled` yazıldı, panelde çevrimiçi.
- Belgeler: `native-ajan.md`, `hosts.md`, `veritabani-sema.md`, `kararlar.md` (uygulama notları), `surum-deploy.md`, `test-dogrulama.md` §4d, `yapilacaklar.md`. Commit/deploy yok. Duyuru gerçek merkezde deploy'dan sonra denenmeli.

## 2026-10-14 16:09 — Güvenlik: Node yolunda yazma öncesi sembolik bağ denetimi
- Sorun: `files/write.ts` üst klasörü geçici container'a bind ediyordu; Docker bind kaynağındaki bağı HOST'ta çözdüğü için izinli kökteki `bag → /etc` üzerinden kök dışına mkdir/rm/mv/chmod/yazma yapılabiliyordu (merkez + Node ajan).
- Düzeltme: yeni saf `src/lib/files/resolve.ts` (`resolveHostPath`, `insideRoots`) + `resolve.test.ts` (7 test); `write.ts` `realParent` (çözülmüş yol köklerde ya da çözülmüş köklerde, yasak değil; bind'a gerçek yol), izin hatasında `elevated.ts` `elevatedResolve` (betikte "resolve"). Yeni metinler `paths.linkOutside`, `paths.linkLoop` (tr/en/de; ajan strings.json yeniden üretildi).
- Doğrulama: typecheck, lint, test 588/588, i18n:check/scan, build, go vet/test. Sunucuda denenmedi. Commit/deploy yok.
- Belgeler: `files.md`, `kararlar.md`, `yapilacaklar.md`.

## 2026-10-14 16:05 — Pi saat eşitlemesi sürekli moda alındı; profil varsayılanları onaylandı
- Pi (192.168.61.107): `dietpi-set_software ntpd-mode 4` → `CONFIG_NTP_MODE=4`, `systemd-timesyncd` etkin+çalışıyor (dbus kuruldu, DietPi ön koşulu). Önce ~19 sn ileriydi; timesyncd 45.74.159.19 ile eşitledi, fark ~1-2 sn (ssh gecikmesi dahil). Ajan aktif.
- Kullanıcı native ajan profil varsayılanlarını (readonly/standard/full) onayladı → `kararlar.md`.
- `yapilacaklar.md`: Pi saat kayması düştü. Commit/deploy yok.

## 2026-10-14 16:02 — İmza anahtarı GitHub sırrına eklendi, yerel kopya silindi
- Kullanıcı `AGENT_SIGNING_KEY` sırrını GitHub Actions'a ekledi. Scratchpad'deki `signing/AGENT_SIGNING_KEY.pem` + `public.pem` silindi, pano temizlendi. Özel anahtar artık yalnız GitHub sırrında (kaybolursa yeni çift + ortak anahtar değişimi gerekir, K5).
- Belgeler: `yapilacaklar.md`, `native-ajan.md`, `surum-deploy.md`. Commit/deploy yok.

## 2026-10-14 14:05 — Güvenlik incelemesi: korunan yolun ATASI üzerinden atlatma kapatıldı
- Bulgu (YÜKSEK): kökler "/" iken `/etc` yeniden adlandırılıp/silinip korunan `/etc/panel-agent` yerinden oynatılabiliyordu. Düzeltme: `files.Fs.containsProtected` (kendisi, içi ya da ATASI) → `Remove`/`Rename` istenen ve çözülmüş yolda `guardAncestor`; `protectedPaths` korunan yolların sembolik bağı çözülmüş hâllerini de ekliyor. Test `TestAjanDosyalariKorunur` genişledi. Go testleri geçti; Pi'ye yeni ikili (prev yedekli), servis aktif. Commit/deploy yok.

## 2026-10-14 13:59 — Faz B adım 5: kendini güncelleme + CI + install-agent.sh
- Kullanıcı kararı: imza anahtarını Claude üretsin, kullanıcı GitHub sırrına eklesin. Ed25519 çifti üretildi; özel anahtar scratchpad `signing/AGENT_SIGNING_KEY.pem` (depo dışı, eklendikten sonra silinecek); ortak anahtar `agent/internal/update/keys.go` + `scripts/install-agent.sh`.
- Kod: `agent/internal/update/` (indir/imza/özet/selftest/.prev/pending/onay/geri alma, durum Node biçiminde), `cmd/release-sign`, `cmd/servedir` (deneme), main: `selftest`, `newUpdater`, `Resume`, `OnVerified→Confirm`; politika çekirdeğine agent.update(+Status). `.github/workflows/agent-release.yml`, `scripts/install-agent.sh`. Merkez: `InstallKit.native` + Sunucu ekle penceresi (native önerilen, Docker açılır), catalog stacks ← `agent.image`.
- Bulunan/düzeltilen: güncelleyicide iki yarış (durum yazımı/bayrak sırası; Status'ta bayrak dosyadan önce) + Windows yeniden adlandırma paylaşım ihlali (kısa yeniden deneme).
- Pi'de geçici sınamalar (hepsi temizlendi): güncelleme + onay, onaysız geri alma, kurulum betiği (bozuk ikili ret, yanlış anahtar ret, kurulum + smoke, purge). Üretim ajanı güncelleyicili ikiliye geçti.
- Gözlem: Pi saati merkezden ~17 sn ileri ve büyüyor (DietPi NTP modu 2) → yapilacaklar.
- Testler: Go tümü (update 20× tekrar), Node 581/581, typecheck/lint/i18n/build. Commit/deploy yok.

## 2026-10-14 13:42 — Güvenlik incelemesi bulguları düzeltildi (helper deseni + ajan dosyaları)
- [YÜKSEK] Helper izin deseni "ilk dolu argümana" uygulanıyordu, komut ise eyleme özgü argümanla kuruluyordu → desen atlatılabiliyordu (compose.up: izinli unit + izinsiz dir). Düzeltme: Go `subjectKey`, Python `panel-helper.py` `ACTION_SUBJECT`, merkez ipucu `HELPER_SUBJECT`. Testler: Go `TestDesenKomuttakiArgumanaUygulanir`; Python için Windows'ta socketserver taklidiyle iki atlatma denemesi reddedildi, izinli dizin desenden geçti.
- [ORTA] Native ajanın dosya işlemleri, kökler "/" ise kendi politika/anahtar/env dosyalarına dokunabilirdi → `Fs.Protected` (main.go `protectedPaths`), rename hedefi dahil. Test `TestAjanDosyalariKorunur`.
- Doğrulama: Go tümü, Node 581/581 + typecheck/lint/i18n; Pi'ye yeni ikili (prev yedekli), merkez API ile docker/dosya/servis gerilemesiz.
- Not: host'lardaki Python helper'ın düzeltmesi yeniden kurulumla gelir (merkez ZimaOS'ta helper yok gibi — `helperConfigured` yerelde HELPER_SECRET'a bağlı).
- Durum: commit/deploy yok.

## 2026-10-14 10:09 — Faz B adım 4c: helper eylemleri native ajanda (K4) — Pi'de çalışıyor
- `agent/internal/helper/` (panel-helper.py eylem tablosu/doğrulayıcılar/hata metinleri birebir), `ops/helper.go` (`helper.call`), politika `allow helper.<eylem> [desen]` + profil varsayılanları (readonly/standard/full — güç, shell.exec, paket yükseltme, docker prune yalnız full), hello `helper: true` + `helperActions`.
- Merkez: `helperActions` tipi; katalog native'de helper durumunu kesin hesaplar (`policyMissing`); ipuçları native'de policy.conf satırları + başlık `where.native`; helper desen reddi compose dışındaysa yeni `argumentDenied` (eski "'?' dizininde compose" hatası Node helper için de düzeldi); `withHint` argüman alıyor. Locale: `permissions.hint.policyMissing|policyConfShould|argumentDenied|where.native`.
- Testler: Go tümü; Node 581/581; typecheck/lint/i18n/build geçti.
- Pi: yeni ikili (prev yedekli) → merkez API ile service.list, service.status, konsol disk.usage çalıştı; power.cancel/shell.exec reddi, apt.upgrade desen reddi doğru.
- Durum: commit/deploy yok. Profil varsayılanları kullanıcı onayı bekliyor (kararlar.md).

## 2026-10-14 10:02 — Faz B adım 4b: native ajanda dosya yöneticisi + host okumaları (Pi'de çalışıyor)
- `agent/internal/files/` (paths: Check/Follow/Parent + sembolik bağ çözümü; browse; write; cleanup (yalnız host dosyası kalemleri); host: listDirs/dirExists/accounts/osReport/scanWatchDir) + `ops/files.go`; politika standard'a `files.*`, `host.*`, `updates.osReport`, `backup.scanDir`; yeni locale `fileWrite.isDirectory`; agent-strings önekleri genişledi.
- Merkez: `src/lib/files/cleanup.ts` native sunucuda Docker kalemlerini merkezde (tünel) hesaplar/temizler (`dockerCleanupItems`), dosya kalemleri ajandan. Typecheck geçti; deploy yok.
- Testler: Go tümü geçti (Windows); sembolik bağ kaçış testi Windows'ta atlandığı için Pi'de çapraz derlenmiş test ikilileriyle koşuldu (`/root/panel-agent-native/testrun`, sonra silindi; Pi'de `/tmp` noexec değil ama ilk deneme çıktısı boştu). Pi'de geçti. Pi'de policy/server testleri eski beklentiler yüzünden düştü → testler yeni standart profile göre düzeltildi (Windows'ta tüm paket koşulmadan geçti sanılmıştı — ders: her değişiklikte `go test ./...`).
- Pi uçtan uca (merkez API, agent kullanıcısı): dosya işlemleri, kök dışı ret, host/users, host/dirs, files/cleanup. Geçici `/opt/panel-native-sinama` silindi.
- Not: Node yazma yolunda bind + sembolik bağ ile kök dışına yazma ihtimali → `yapilacaklar.md`.

## 2026-10-14 09:53 — Faz B adım 4a: native ajanda Docker tüneli + terminal (Pi'de çalışıyor)
- `agent/internal/docker/` (policy, client, exec + testler: vektörler, sahte unix-soket Docker'ına karşı tünel/akış/süre aşımı/hijack terminal, yarım UTF-8), `agent/internal/ops/docker.go`; politika standard'a `docker.api`, `docker.apiStream`, `exec.*`; `agent-strings` önekleri `execLib.`, `dockerUpdate.notFound`, `api.notFound.session`.
- Pi'ye yeni armv7 ikili (`panel-agent.prev` önceki), servis yeniden başlatıldı (sertifika aynı, yeniden kayıt gerekmedi). Merkez (deploy'daki 1.13.1, değişiklik yok) Pi'yi tünel modunda kullanıyor: Docker ✅, 6 container + istatistik, log SSE, kaynaklar, olaylar, terminal (ğüş, exitCode 3) uçtan uca doğrulandı. RSS 13,7 MB.
- Sınama için Pi'de `hello-world` bir kez `--rm` ile çalıştırıldı (3 olay kaydı).
- Durum: commit/deploy yok. Sıradaki 4b (files/host ops), 4c (helper).

## 2026-10-14 09:45 — Pi tek kayıt: DietPi (host 3) native Go ajana taşındı
- Kullanıcı panelde Claude için `agent` kullanıcısı açtı; "Pi için tek bağlantı" + seçimi "Go ajan, tek kayıt altında (geçmiş korunur)".
- API ile pi-native (host 4) silindi. Pi'de: Go ajan sırrı Node ajanın `.env` `AGENT_TOKEN`'ından kopyalandı (Pi dışına çıkmadı), port 7443, systemd `panel-agent-native.service` (enable, Restart=always, After=time-sync.target); Node ajan `docker compose -p panel-agent stop` (silinmedi). Merkezde `POST /api/hosts/3/enroll` → online, 37 ms, capabilities native + 4 op; metrikler 5 sn'de 21 değer.
- Beklenen yan etki: deploy'daki merkez Docker'sız sunucuya olay izleyicisi açmaya devam ediyor → `[docker-events] DietPi: … uyumsuz` logu (düzeltme yerelde). Pi'de Docker/dosya/log/yedek adım 4'e kadar yok.
- Geri dönüş `hosts.md`. Durum: commit/deploy yok.

## 2026-10-14 09:34 — Native ajan Pi'de denendi (kullanıcı onayıyla) + Docker'sız sunucu düzeltmesi
- Pi: `/root/panel-agent-native/` (armv7 ikili, SHA256 eşleşti; `agent.env` 0600; `pid`), port 7444, elle `setsid` (systemd yok — adım 5). Node ajan 7443'te dokunulmadı.
- Önce geçici sırla `agent-smoke.ts` (gerçek veri: 4 çekirdek, 21 metrik, 1 sensör); sonra kullanıcı merkezde "pi-native" (host 4) ekledi, sırrı verdi, ajan o sırla yeniden başlatıldı, kullanıcı kaydı tamamladı → online, 52 ms, capabilities `native`+4 op, metrikler 5 sn'de 21 değer.
- Node ajanla aynı Pi'de karşılaştırma (Node tarafı container içinden, sırrı dışarı çıkmadan): system.info birebir, metrik anahtarları 21/21, donanım biçimi aynı. Kaynak: Go 13 MB / %1,9 tek çekirdek; Node 145 MB / %8,8 (Docker toplama dahil). Pi saati merkezden ~10 sn ileri.
- Bulgu: merkez Docker'ı olmayan sunucuya da Docker olay izleyicisi açıyor → "ajan uyumsuz" logu tekrar ediyor (deploy'daki merkezde sürüyor, zararsız). Yerel düzeltme: `hosts/store.ts` `hostHasDocker`/`dockerHosts`; `docker/events.ts` `watchable`; `jobs/definitions.ts` `docker.collect`/`docker.autoprune`/`updates.images` → `perHost(…, dockerHosts)`; `logs/collect.ts` container kısmı atlanır. Testler 576/576.
- Durum: commit/deploy yok. pi-native kaydı ve Pi'deki süreç ÇALIŞIR durumda bırakıldı (kullanıcı kararı bekleniyor).

## 2026-10-14 08:52 — Faz B adım 3: native (Go) ajan çekirdeği
- Go: winget bu ortamda takıldı (kurucu hiç başlamadı, `winget list` bile yanıt vermedi) → kullanıcının onayladığı "Go kur" için resmî go.dev zip'i (go1.27.2, SHA256 doğrulandı) `%LOCALAPPDATA%\go-sdk\go`'ya açıldı; yönetici izni gerekmedi, PATH'e eklenmedi.
- `agent/` (yalnız stdlib): protocol (imza/doğrulama/kayıt kanıtı/codec, sıralı `Reply`/`Frame` — Node ile kablo birebir), server (rpc/stream/enroll, nonce, 20 hata/dk kilit, politika, NDJSON flush, panic koruması), cert (ECDSA P-256, Node parmak izi biçimi), ops (`agent.hello` + `native`/`ops`, `system.info`, `metrics.sample`, `hardware.report`), hostinfo (`metrics.live.ts`/`hardware.live.ts`/`system.live.ts` karşılıkları), policy (K3 iskeleti: profile/allow/deny, mtime ile yeniden okuma, bozuk dosya → yalnız çekirdek), i18n (`strings.json` panel dillerinden `scripts/agent-strings.mjs` ile üretilir).
- Derleme `scripts/build-agent.sh`: amd64 7,4 MB, arm64 6,7 MB, armv7 7,3 MB (+386, armv6). `agent/dist/` gitignore, `agent` .dockerignore.
- Merkez: `AgentHello`/`HostCapabilities` `native?`/`ops?`; `client.ts` unknown-op (404) ve `policy-denied` → `HostError("unsupported")` (eskiden 404 = "uyumsuz"); katalog `ops` + `agentOpMissing`; `/hosts` "native" rozeti; locale `hosts.errors.policyDenied`, `permissions.hint.agentOpMissing`, `hosts.native.*`. Ek: `HostsScreen`/`UpdateScreen` doğrudan `formatDateTime` çağrılarına panel saat dilimi.
- Doğrulama: `go vet` + `go test` (protocol vektörleri, server uçtan uca, hostinfo sahte /proc, policy, i18n) geçti; Node 576/576, typecheck/lint/i18n geçti; `scripts/agent-smoke.ts` ile merkezin protocol.ts'i → yerel Go ajanı (Windows, 127.0.0.1:17443) 8/8. Pi'de gerçek veriyle deneme YAPILMADI (izin istenecek).
- Belgeler: yeni `native-ajan.md`, `README.md` dizini, `hosts.md`, `host-helper.md` (K4 yol haritası), `kararlar.md`, `tarifler.md`, `surum-deploy.md`, `test-dogrulama.md` §4c, `yapilacaklar.md`. Durum: commit edilmedi, deploy edilmedi.

## 2026-10-14 08:31 — Saat dilimi tek kaynaktan (`general.timezone`)
- Sorun (kullanıcı notu): yedek "Sonraki yedek" Genel bakışta 09:00, sekmelerde 06:00. Merkez container'ında `TZ` boş → Node UTC; `cron-parser` tz'siz (UTC) → `0 6 * * *` gerçekte TR 09:00'da çalışıyordu; `CronEditor` önizlemesi tarayıcı saatiyle 06:00 diyordu. `general.timezone` ayarı vardı ama yalnız hava durumu kullanıyordu.
- Çözüm: `src/lib/time/zone.ts` (+ `zone.server.ts`); süreç `process.env.TZ` açılışta (`instrumentation.ts`) ve ayar değişince (`settings/index.ts` `afterChange`); `backup/scheduler.ts` + `jobs/runner.ts` açık `tz`; `i18n/format.ts` `timeZone` parametresi, `I18nProvider timeZone` + `useTimeZone()`; `cron/friendly.ts` `nextRuns(…, timeZone)` duvar saatinde eşleştirir; yeni ayar tipi `timezone` + `TimeZoneSelect` (aranabilir, "bu dilimde şu an", "tarayıcınınkini kullan"); locale tr/en/de.
- Test: `src/lib/time/zone.test.ts` (10) — istemci önizlemesi = sunucu `cron-parser` (yaz saati geri/ileri alış dahil). Tümü 575/575; typecheck, lint, i18n, build geçti. Arayüz MOCK dev'de gözle denenmedi.
- Etki: deploy edilince zamanlamalar fiilen 3 saat erkene (yazıldıkları yerel saate) kayar.
- Belgeler: `kararlar.md` (yeni karar), `settings.md`, `backup.md`. Durum: commit edilmedi, deploy edilmedi.

## 2026-10-14 07:30 — Tüm deploy/proje yedekleri silindi (kullanıcı isteği)
- Merkez: `panel.db.pre-dedupe-20261014.bak`, `data/backups/` (`pre-migration-33/34/35.db`, `panel-db-snapshot.db`), compose dizininde tüm `docker-compose.yml.*.bak` (6), `.panel-backups/*.tgz` (2), `/tmp/panel-deploy-20261011-2008.tgz`. /DATA %19 dolu.
- Pi: `/root/panel-agent/.env.agent-deploy-*` (3) + `.env.manual-1.13.1-*`, `.panel-backups/*.tgz` (5), `/root/panel-agent-build-1.13.1`.
- Yerel: dev sunucusu (3107, MOCK doğrulaması) durduruldu, oturum scratchpad'i (merkez `/app` arşivi, mock DB, betikler, deploy logları) silindi.
- Sonuç: geri dönüş için yedek YOK — deploy.sh önceki imajı da silmişti; geri dönüş = eski commit'ten yeniden derleme. Merkez ve Pi healthy.

## 2026-10-14 07:15 — Tekrarlanan olaylar silindi; Faz A + Faz B adım 2 + 1.13.1 commit edildi
- Kullanıcı onayıyla merkez DB'de akış hatasının iki kez yazdığı 37 docker olayı silindi (her (host, ts, alert_key, title, detail) grubunun en küçük id'si kaldı; 31 Pi + 6 yerel, hepsi 2026-10-13 21:xx). Önce `VACUUM INTO /app/data/panel.db.pre-dedupe-20261014.bak` (≈397 MB, işe yaramadığı görülünce silinebilir); sonra sayım 0.
- Commit (main, push/etiket YOK): Faz A (D1/D6/kurulum ipucu/yoklama), Faz B adım 2 (DockerTransport, `docker.api`, vektörler), 1.13.1 sürüm dosyaları, iki düzeltme (akış zaman aşımı, log `tail`).
- Commit'e alınmayan: silinmiş görünen `panel-deploy-20261011-1758.tgz` / `-1809.tgz` (cfbacd3'te yanlışlıkla repoya girmiş deploy paketleri; silinmeleri kullanıcıya soruldu).
- Durum: commit edildi, push edilmedi. Açık: GHCR yayını (etiket) — Pi'yi normal güncelleme yoluna döndürmek için.

## 2026-10-14 01:01 — 1.13.1 iki sunucuda; deploy sonrası 2 hata bulundu ve düzeltildi
- Pi: kullanıcı izniyle yerel ajan imajı kuruldu (`panel-agent-local:1.13.1`, merkez imajının `/app`'i + armv7 1.13.0 tabanı; yöntem `surum-deploy.md`). `.env` yedeği `.env.manual-1.13.1-20261013-213942`. Ajan içinden imzalı `docker.api` sınaması 18/18 (izinli uçlar, sürüm öneki, 404, log/olay akışı, swarm/secrets/attach/`..`/images-load reddi, eski `docker.list` yolu).
- **Regresyon (benim)**: `transport.ts` süresiz akışlara da zaman aşımı dinleyicisi takıyordu; Node 20+ varsayılan ajanının 5 sn boşta süresiyle olay akışları (merkez yerel + Pi) sürekli koptu, `since` tekrarıyla olaylar 2× yazıldı (21:29–21:49 arası 74 kayıt / 37 benzersiz). Düzeltme: süresiz istekte `agent: false` + dinleyici yok; regresyon testi (5,6 sn sessiz akış; düzeltmesiz 5,0 sn'de kırıldığı görüldü). Ek: `eventmap.ts` `acceptEvent` (imleç saniyesindeki olay anahtarları) — yeniden bağlanmada tekrar yazımı engeller (eski hata). Sonrası: 6/6 benzersiz, kopma yok.
- **Önceden var olan hata**: log toplayıcı imleç varken `tail=0` gönderiyordu; Docker 27.5 (API 1.47) 0 satır döndürüyor → 2026-10-12 08:21'den beri container logu toplanmıyordu. `tail = logs.max_lines_per_source`; ilk turda 13.202 (merkez) + 2.911 (Pi) satır.
- Merkez–tünel canlı sınaması: Pi için `agents.docker_transport=api` (DB'ye `updated_by=claude-dogrulama`) → metrikler 47 satır/15 sn sürdü, `hello-world` olayları birer kez geldi, hata/ret yok → ayar silindi (varsayılan rpc).
- Son durum: merkez healthy 1.13.1 (3. deploy, compose yedeği `…deploy-20261014-0058.bak` civarı), Pi `panel-agent-local:1.13.1` healthy, hosts online, iş hatası yok. Pi ölçümü (taze süreç): RSS 124 MB, CPU dalgalı %0–93. Testler 565/565 + eventmap.
- Durum: commit edilmedi. Açık: ~37 tekrarlanmış olay kaydı (silme onayı), GHCR yayını.

## 2026-10-14 00:33 — 1.13.1 (commit'siz) merkeze deploy edildi; Pi bekliyor
- Kullanıcının isteğiyle commit OLMADAN `bash scripts/set-version.sh patch` → 1.13.1 (8 dosya). Faz A + Faz B adım 2 bu sürümde.
- Merkez (ZimaOS 192.168.61.114): `bash deploy.sh` başarılı — healthy, `APP_VERSION=1.13.1`, şema v35 (yeni migration yok), log hatasız. Compose yedeği `docker-compose.yml.deploy-20261014-0028.bak`; deploy.sh önceki yerel imajı sildi (geri dönüş için yeniden derleme gerekir). Mount'lar (docker.sock, /host/proc, /host/root) bağlı → yerel sunucu etkin kaldı. `/api/health` 200, korumalı sayfalar `/login?next=`'e yönleniyor. Docker olay akışı açılışta bir kez "aborted" verip 2 sn'de yeniden bağlandı, sonra kesintisiz (olaylar kayda düşüyor).
- Bulgu: Pi ajanı 1.13.0 imajında ama kendini **1.12.7** bildiriyor (v1.13.0 etiketinde Dockerfile `ARG APP_VERSION=1.12.7` kalmış). Merkez 1.13.1 olunca `agents.auto_update` Pi'yi v1.13.1'e güncellemeyi denedi → GHCR'de yok → updater `pull` adımında durdu, ajan 1.13.0'da sağlıklı; durum `failed v1.13.1` (etiket başına bir kez).
- Pi (192.168.61.107): yerel ajan imajı planı hazır (merkez imajından `/app` → `panel-app-1.13.1.tgz`, Pi'de `FROM …:1.13.0` + `/app` değişimi, `panel-agent-local:1.13.1`; doğrulama betiği `agent-check.mjs`, scratchpad'de) ama Pi'ye yazma izin sınıflandırıcısınca REDDEDİLDİ → kullanıcı izni bekleniyor. Pi'de değişiklik yok.
- Durum: commit edilmedi.

## 2026-10-13 23:18 — Faz B adım 2: DockerTransport + docker.api tüneli + ortak protokol vektörleri
- `src/lib/docker/transport.ts`: `DockerTransport` (request / stream / yalnız yerel `hijack`), `localDockerTransport` (docker.sock), `dockerTransport()` + `runWithDockerTransport` + `bindDockerTransport` (AsyncLocalStorage; üreteçlerde her `next()` sarılı). `docker.live.ts` (7), `docker/exec.ts` (2), `docker/events.ts` (2) soket noktaları buna geçti — kodda Docker soketini yalnız `transport.ts` açıyor. `docker.live.ts` imzaları değişmedi.
- Ajan (Node): yeni op'lar `docker.api` (rpc) ve `docker.apiStream` (ilk çerçeve `{status,headers}`, sonra `Buffer` parçaları); izin listesi saf `src/lib/agent/docker-api-policy.ts` (`checkDockerApi`, `prepareDockerApiRequest`: kapalı yöntem+yol listesi, sürüm öneki, `..`/`//`/kontrol karakteri reddi, yalnız `content-type` başlığı, gövde ≤256 MB, süre ≤6 sa). Hello `capabilities.dockerApi: true, dockerRpc: true`. `AGENT_PROTOCOL` 3'te kaldı (yalnız ekleme).
- Merkez: `transport.remote.ts` (`remoteDockerTransport`, `remoteDockerMode`); `providersFor` tünel modunda `bindDockerTransport(liveDockerProvider, remote)`; olay izleyicisi tünelde `/events`. Yeni ayar `agents.docker_transport` (sunucuya özel, auto/api/rpc; auto = Node ajanında rpc, native ajanda api) — varsayılan davranış DEĞİŞMEDİ.
- Ortak vektörler `protocol/vectors-v3.json` (`npm run protocol:vectors`, `scripts/protocol-vectors.ts`; belirlenimci): imza/doğrulama, parmak izi/kayıt kanıtı, `$t` codec'i (dilden bağımsız tarif), 47 izin listesi + 8 istek hazırlama durumu, örnek RPC/akış mesajları. `vectors.test.ts` TS uygulamasını dosyaya karşı sınar.
- Testler: `transport.test.ts` (bağlama, paralel izolasyon, üreteç, gerçek HTTP sunucusuna (Windows'ta named pipe) istek/akış/zaman aşımı) + `vectors.test.ts` → 560+ test geçti; typecheck, lint, i18n:check (3876), i18n:scan, build geçti (uyarılar önceden var). Kullanılmayan `execLib.socketTimeout` silindi.
- Belgeler: `kararlar.md` (K2 uygulaması + "etkileşimli terminal tünelden geçmez" — kullanıcı onayı bekliyor), `tarifler.md`, `hosts.md`, `docker.md`, `test-dogrulama.md` §4b (Pi doğrulama runbook'u), `yapilacaklar.md`.
- Durum: commit edilmedi; Pi'de DOĞRULANMADI (yeni ajan sürümü gerekiyor).

## 2026-10-13 22:47 — Faz B karar kapısı: Pi ölçümü (192.168.61.107)
- Kullanıcıdan alındı (salt okunur komutlar, sunucuda değişiklik yok). RAM 969 MB (kullanılabilir ~595), swap 1 GB boş; kök dosya sistemi SD kartta (`mmcblk0p2`, 115 GB, %4 dolu); `/var/log` 50 MB tmpfs (DietPi RAMlog), `/tmp` 1 GB tmpfs.
- `docker stats`: Node ajanı (`panel-agent-panel-agent-1`, 1.13.0) tek ölçümde **%141 CPU**, 21 PID, 47 saatte ağ 1.66 GB gelen / 862 MB giden. Bellek sütunları 0B — çekirdekte cgroup bellek muhasebesi kapalı (container belleği Pi'de görünmüyor; ajan RSS'i için `ps` gerekli).
- İmajlar: ajan 1.13.0 diskte 536 MB (1.12.x 365 MB; artış envanterdeki DB istemcileri), eski 1.11.1/1.12.6/1.12.7 ~1.09 GB kullanılmıyor, `docker:27-cli` 253 MB (updater), `panel-rollback` = 1.13.0. Pi'de ayrıca pihole, mosquitto, zigbee2mqtt, hawser çalışıyor.
- Sonuç: native ajan gerekçesi (CPU, imaj boyutu, SD aşınması) ölçümle destekleniyor; RSS ve CPU'nun tekrarlı örneği istendi. Durum: kod değişikliği yok.
- Ek ölçüm (bu bilgisayardan `ssh root@192.168.61.107`, anahtar kullanıcı tarafından eklendi; yalnız okuma): Pi 2 Model B Rev 1.1, 4 çekirdek, armv7l, yük ~0.6. Ajan süreci `next-server` **RSS 142 MB**, ömür boyu ortalama %12.5 CPU; 10 sn arayla örnekler %30 / %24 / %0.25 (dalgalı — ilk %141 bir tepe). dockerd 54 MB + containerd 35 MB. Çekirdek satırında `cgroup_disable=memory` (Pi çekirdeği varsayılanı) → container belleği Docker'dan okunamaz. Pi saati merkezden ~3 sa geride görünüyor (büyük olasılıkla saat dilimi; imza çalıştığına göre UTC aynı).
- Native ajan için baz değer: 142 MB RSS, ~%12 ortalama CPU, 536 MB imaj.

## 2026-10-13 22:34 — Faz A: boş başlangıç (D1), yetki yönergesi (D6), /kurulum ipucu, yetki yoklaması
- Kararlar `kararlar.md`'ye eklendi (native ajan K1–K5 + D1/D6, 2026-09-24 kararı yumuşatıldı). Kullanıcı seçimleri: yerel ÜÇ mount da yoksa kapanır; yalnız panel kapattıysa geri açılır; yoklama Faz A'da mevcut capabilities ile.
- D1: `hosts/local-probe.ts` (saf) + `local-state.ts` (açılışta `applyLocalProbe`, işaret `cache` `hosts:local-auto-disabled`); `pickHost` yerele değil `defaultHostId`'ye düşer, sunucu yoksa `none`; `currentHostId()` çözücüsü `globalThis`'te (instrumentation kaydeder), yoksa `HostError("noHost")`; `currentHostIdOrNull` / `contextHostId` (ayarlar, bildirim, denetim). `providersFor` bilinmeyen/kapalı yerele düşmez; self-update `localProviders()`. API 409 `noHost`; `/ilk-sunucu` sayfası (layout `x-panel-path` + `pageHostId` yönlendirir, muafiyet `NO_HOST_PATHS`). Yerel artık `/hosts`'tan kapatılabilir (silinemez; mount'suz açılamaz). Yalnız yerel merkezi işler `LOCAL_ONLY_JOBS` ile yerel bağlamda / kapalıysa atlanır.
- D6: `/yetki-yok?need=` (+ `users?tab=roles&role=`), 403 `{code:"forbidden", need}`; `permissions/hint.ts` (saf `buildHint`, sunucuya özel komutlar) + `hint.server.ts` `hintFor`; `permissions/catalog.ts` (15 özellik, `evaluateFeature`); `components/permissions/HintBox.tsx`. Sarılanlar: 501 unsupported, noHost, helper soket/secret/izin listesi (`callHelper` ipucunu seçili sunucu için merkezde yeniden kurar), host/console/compose uçları, yığın kurulum + ön kontrol, fail2ban, Docker soket. Mevcut `error` metinleri aynı.
- Yoklama: `GET /api/hosts` `features`; `/hosts` satırında ✅/🟡/🔴 özeti + "Özellikler" penceresi.
- /kurulum: `docker logs <container> 2>&1 | grep "Kurulum kodu"`, `docker ps`, ZimaOS günlükleri; kod mantığı aynı.
- Testler: `resolve`/`context` güncellendi, yeni `local-probe`, `permissions/hint`, `permissions/catalog` → 545/545. typecheck, lint, i18n:check (3872), i18n:scan, build geçti (build'deki NFT ve Edge uyarıları önceden var). MOCK dev (DATA_DIR geçici, MOCK_HOSTS=2): kurulum ipucu, yerel kapat → mock-2 varsayılan, ikisi de kapalı → `/ilk-sunucu` 307 + API 409, izinsiz kullanıcı → `/yetki-yok` + 403 `need`, `?tab=roles&role=3`, yoklama özeti, iş hatası yok.
- Sapmalar: karşılama layout içinde değil ayrı `/ilk-sunucu` sayfası (istemci gezinmesinde layout yeniden çalışmıyor); `/hosts/unavailable`'a HintBox eklenmedi (panel tarafı, komut yok). `tarifler.md`'deki eski `apiv1/TOKEN_FORBIDDEN` satırı düzeltildi. `LOCAL_HOST_ID` 31 satır/14 dosya (49 değil).
- Durum: commit edilmedi, deploy edilmedi. Sıradaki: Faz B — önce Pi ölçümü istenecek.

## 2026-10-11 20:35 — deploy.sh ZimaOS/CasaOS kurulumu için yeniden yazıldı
- İkinci deploy denemesi `mkdir: cannot create directory '/home/coraspirin': Read-only file system` ile düştü. İnceleme (salt okunur, root SSH): sunucu artık ZimaOS 1.7.1 (CasaOS); panel CasaOS uygulaması `server-management-panel` (GHCR 1.13.0 imajı, port 8081, veri `/DATA/AppData/server-panel`, compose `/var/lib/casaos/apps/compose-75a5218c7cbc9fd0`). Caddy yok.
- Kullanıcı seçimi (seçenek 1): kaynak `/DATA/AppData/server-panel-src`'ye, imaj sunucuda derlenir (`server-panel:local`), CasaOS compose'unda yalnız `image:` değişir (yedekli), `up -d --pull never`, sağlık kontrolü, önceki yerel imaj silinir. Önceki sürümdeki ilk kurulum/Caddy geçişi mantığı kaldırıldı (bu sunucuda gereksiz).
- Doğrulama: `bash -n` (ana + 4 uzak blok); `image:` değiştirme bloğu CasaOS compose kopyasında denendi (yalnız o satır değişti); 0. adım gerçek sunucuda çalıştırıldı ve doğru çözümledi. Derleme/yeniden başlatma sunucuda ÇALIŞTIRILMADI.
- Belgeler: `surum-deploy.md`, `test-dogrulama.md` (sunucu bilgileri), `kararlar.md`, `yapilacaklar.md`. Durum: commit edilmedi.

## 2026-10-11 18:12 — deploy.sh yeni sisteme göre yeniden yazıldı
- Kullanıcı deploy.sh'ı çalıştırdı: sunucuda `/home/coraspirin/docker/server-panel` yok → 3. adımda düştü. Sunucuyu incelemek için SSH denemesi önce `coraspirin` ile reddedildi (betik `~/.ssh/config` ile root kullanıyor), sonra sunucu bağlantıyı kapattı; incelenemedi.
- deploy.sh: 0. adımda sunucu durumu (ilk kurulum / Caddy'li eski kurulum / güncelleme / docker yok); ilk kurulumda dizin + compose + `.env` (MASTER_KEY, DOCKER_GID üretilir) + `reports/`; Caddy'li kurulumda eski compose `.bak`, caddy durdurulup silinir, yeni compose yazılır; port kontrolü; `up -d --remove-orphans`; container adı `docker compose ps -q panel`'den; kurulum kodu ekrana; `PANEL_HOST`/`PANEL_DIR` ile hedef değiştirilebilir; yedek artık `dirname(PANEL_DIR)/panel-yedek-*.tgz` ve compose/.env/Caddyfile'ı da içeriyor.
- Doğrulama: `bash -n` (ana betik + 4 uzak blok); yükleme bloğu yerelde sahte dizinle üç durumda çalıştırıldı (ilk kurulum dosyaları + .env, güncellemede compose korunuyor/eski src siliniyor/APP_VERSION tek satır, Caddy geçişinde .bak + `docker compose stop/rm caddy` + caddy'siz compose + .env temizliği). Sunucuda çalıştırılmadı.
- Belgeler: `surum-deploy.md`, `yapilacaklar.md`. Durum: commit edilmedi.

## 2026-10-11 17:36 — Panel sadeleştirme + log/olay temizleme
- Kullanıcının isteğiyle tamamen kaldırıldı: Uygulamalar (kartlar, kategoriler, logo, keşif, Pi-hole widget'ı, yer imleri, hızlı bağlantılar), kiosk, herkese açık karşılama sayfası, yayınlama (proxy/Caddy/sertifika/DDNS/teşhis), Tailscale, güvenlik duvarı (ufw) ekranı + helper `ufw.*` eylemleri, dış API (`/api/v1`, API token'ları, `api.manage`, `/metrics`, `docs/API.md`, `docs/openapi.yaml`, `check:openapi`, CI adımları).
- `/` artık yalnız yönlendirir: kurulum → `/kurulum`, oturum → `/panel`, yoksa `/login`. Logo `/panel`'e gider.
- Caddy tamamen kalktı (kullanıcı kararı): compose'da `caddy` servisi/volume'leri ve tailscaled mount'u yok, panel `${PANEL_HTTP_PORT:-8080}:3000`. İstemci IP'si için `scripts/docker-entry.mjs`'e ön katman (`startFront`): Next 127.0.0.1:3001, ön katman `X-Real-IP`/`X-Forwarded-*`'ı soketten yazar; `PANEL_TRUST_PROXY=1` kendi TLS vekili için. `panelPorts()` `security/ports.ts`'e taşındı.
- Migration `035_drop_removed_features.ts`: 9 tablo DROP + izin/ayar/iş/widget artıkları.
- Yeni: `/logs` ve `/events`'e "Kayıtları temizle" — `DELETE /api/logs` (`settings.edit`, `clearLogs`, imleçler korunur) ve `DELETE /api/events` (`monitors.manage`, `clearEvents`); seçili sunucu, `confirm()`, audit `logs.clear`/`events.clear`.
- Locale: ~590 anahtar silindi; paylaşılanlar `common.*`/`api.auth.*`'a taşındı (`proxy.form.port` → `common.port` vb.); kaldırılan özelliklerden bahseden yardım metinleri yeniden yazıldı. Ayar ekranındaki `container`/`richtext` tipleri ve `ContainerSelect`, `RichTextField`, `lib/richtext.ts` gitti.
- Doğrulama: typecheck, eslint, i18n:check (3800/3800), i18n:scan, `npm test` 516/516 (apiv1/firewall testleri silindi), `npm run build`. MOCK dev: eski yerel DB kopyasında şema 25→35 sorunsuz, tablolar düştü, `apps.install` kaldı; boş DB'de kurulum → `/` → `/panel`, sayfalar 200, temizleme uçları (CSRF'siz 403, FTS boşaldı, imleçler kaldı, audit yazıldı). Standalone + ön katman: 0→35 migration, health 200, Next LAN'dan erişilemez, uydurma `X-Forwarded-For: 6.6.6.6` yok sayıldı (audit gerçek IP).
- Belgeler: `_Claude/{README,_digerleri,hesap,host-helper,kararlar,network,panel,security,settings,surum-deploy,tarifler,test-dogrulama,veritabani-sema,logs,events,yapilacaklar}.md`, silindi `apps.md`/`proxy.md`/`firewall.md`; README.md, README_tr.md, screenshots/README.md.
- Durum: commit edilmedi, deploy edilmedi. Açık: sunucuda Caddy'siz compose'a ELLE geçiş (`surum-deploy.md`), `.env.example` (okuma izni engelli) güncellenmedi.

## 2026-10-09 17:43 — İlk kurulum sihirbazı (/kurulum)
- Önceden kullanıcı yoksa `bootstrap.ts` `admin`'i `ADMIN_PASSWORD` ile (yoksa loga rastgele parola) kendisi açıyordu; sihirbaz hiç yoktu. Kullanıcının isteğiyle yerine sihirbaz geldi: açılışta tek kullanımlık kurulum kodu loga basılıyor, `/kurulum` bu kodu isteyip ilk yöneticiyi oluşturuyor ve içeri alıyor. Kullanıcı yokken `/` ve `/login` sihirbaza yönlendiriyor.
- Yeni: `src/lib/auth/setup.ts`, `src/app/api/auth/setup/route.ts`, `src/app/kurulum/{page,SetupForm}.tsx`. Silinen: `src/lib/auth/bootstrap.ts`. Değişen: `instrumentation.ts`, `middleware.ts`, `app/page.tsx`, `app/login/page.tsx`, locale'ler (`bootstrapLib.*` → `setup.*`, `auth.password.forcedNotice` artık loga atıf yapmıyor).
- `ADMIN_USERNAME`/`ADMIN_PASSWORD` kaldırıldı: `docker-compose.yml`, `.env.example`, yerel `.env`, `ci.yml`, 3 README.
- Doğrulama: typecheck, eslint, i18n:check/scan, `npm test` (619/619). Boş veritabanıyla MOCK dev sunucusunda: kod loga basıldı; `/` ve `/login` → `/kurulum`; yanlış kod 403, zayıf parola 400, doğru kod (küçük harf/boşluklu) 200 + oturum; tekrar 409; `/kurulum` → `/login`; yeniden başlatmada kod basılmadı; audit kayıtları doğru. `npm run build` başarılı. Sunucuda deneme yapılmadı.
- Durum: commit edilmedi. Belgeler: `_digerleri.md`, `kararlar.md`, `veritabani-sema.md`.

## 2026-10-09 01:12 — Genel rehberler eklendi
- Yeni: `_Claude/surum-deploy.md` (deploy.sh + `scripts/set-version.sh` + GHCR + ajan güncelleme + geri alma), `yapilacaklar.md` (açık işler, doğrulanmamışlar, bilinen sınırlamalar), `kararlar.md` (mimari karar kaydı), `tarifler.md` (sayfa/uç/op/sağlayıcı/migration/ayar/izin/locale/widget/job ekleme), `test-dogrulama.md`, `veritabani-sema.md` (tüm tablolar, migration, host_id, kullanan lib), `host-helper.md` (eylem listesi, güvenlik, kurulum).
- `_Claude/README.md`'ye "Genel rehberler" tablosu; `CLAUDE.md`'ye iş başında memory/yapilacaklar/kararlar okuma kuralı.
- Düzeltmeler: ayarların tek kaynağı `src/settings.schema.ts` (README/settings.md yanlış gösteriyordu); host cron yazması helper değil geçici container (`hostcron.md`); token yasak izinleri `apiv1/guard.ts` `TOKEN_FORBIDDEN`.
- Yollar betikle doğrulandı. Durum: commit edilmedi.

## 2026-10-09 01:01 — İşlem kaydı (bu dosya) oluşturuldu
- `_Claude/memory.md` açıldı; `CLAUDE.md`'ye "her işlemden sonra buraya kayıt ekle" kuralı eklendi.
- Durum: commit edilmedi.

## 2026-10-09 00:50 — Sayfa rehberleri (`_Claude/*.md`)
- 25 panel sayfası + `_digerleri.md` (/, /login, /kiosk, /metrics) için Türkçe rehber; `_Claude/README.md` dizin + ortak altyapı; kök `CLAUDE.md` (önce rehberi oku, kod değişince güncelle).
- Yollar betikle doğrulandı; `events.md` ve `monitoring.md`'de iki yanlış referans düzeltildi.
- Durum: commit edilmedi.

## 2026-10-08 23:30 — Veritabanı envanterine SQLite dosyaları
- Sorun: Defterim'in DB'si görünmüyordu — ayrı sunucu değil, `defterim_defterim-data` volume'ünde `/data/db/defterim.db` (SQLite). Sunucuda ~20 SQLite DB var.
- `src/lib/dbadmin/exec/sqlite-scan.ts`: container volume/bind'larını root geçici container'da tarar ("SQLite format 3" başlığı, yedek/önbellek/_old filtresi). Dosya başına `db_connections` satırı (`sqlite:<yol>`), ağaçta container'a göre gruplu.
- Değişenler: `exec/inventory.ts`, `store.ts` (`pruneInstances(keys, scanned)`), `types.ts`, `InventoryTree.tsx`, `DatabaseScreen.tsx`, locale.
- Tarama betiği sunucuda panel imajıyla denendi (0,4 sn, defterim.db bulundu). typecheck/lint/619 test/build yeşil.
- Durum: commit edilmedi, deploy edilmedi.

## 2026-10-08 — Veritabanı sayfası otomatik envanter olarak yeniden yazıldı
- Sorun: sayfa yalnız elle kaydedilen bağlantıları listeliyordu; içe aktarılan container'lara ad ile TCP → ajan ayrı ağda (ENOTFOUND); native DB'ler hiç bulunmuyordu.
- Çözüm ("exec transport"): Docker DB → container içinde `docker exec` ile kendi istemcisi; native → panel imajından geçici container + host soketi (MySQL root unix_socket → debian.cnf; Postgres peer). SQL `PANEL_SQL` env → stdin.
- Yönetim: DB oluştur/sil, kullanıcı/parola, yetki (tam/salt-okunur), tek DB `.sql.gz` dökümü.
- Yeni: `src/lib/dbadmin/exec/{runner,inventory,native,admin,parse}.ts`, `api/database/{admin,dump}/route.ts`, `AdminModals.tsx`, `InventoryTree.tsx`, `api.ts`, migration `034_dbadmin_inventory.ts`, `parse.test.ts`.
- Değişen: `providers/types.ts` + `docker.live.ts` (`runOnce` → `{env,user,timeoutMs}` + stdout/stderr), `agent/ops.ts` (`db.native`), `backup/{discover,sources}.ts` (kimliksiz envanter satırları sayılmaz), `Dockerfile` (mariadb-client, postgresql-client, redis-tools), locale'ler.
- Durum: commit edilmedi; sunucuda tam akış denenmedi; uzak ajanlar için yeni sürüm gerekiyor.
