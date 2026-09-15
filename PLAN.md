# Sunucu Yönetim Paneli — 192.168.61.114 (3 Fazlı)

## Context (Neden / Amaç)

`192.168.61.114` yerel ağdaki bir **Ubuntu/Debian + Docker** sunucusu (Home Assistant da mevcut). Bu sunucu için sıfırdan **özel bir sunucu yönetim paneli** yazacağız: izleme + Docker/sistem yönetimi + servislere hızlı erişim (app launcher) + gelişmiş yönetim/otomasyon. Uygulama Docker container'ı olarak sunucuda çalışır. Geliştirme makinesinden sunucuya **SSH erişimi vardır** (LAN + Tailscale), bu yüzden dağıtım ve doğrulama uzaktan yapılabilir.

Geliştirme **üç faza** bölünmüştür ve **her faz tamamlanıp kullanıcı onayı ("faz bitti") alınmadan bir sonraki faza geçilmeyecektir.**

## Ortak Teknoloji Yığını

| Katman | Seçim |
|---|---|
| Framework | **Next.js 16 (App Router) + React 19 + TypeScript** (frontend + API tek container) |
| UI | **Tailwind CSS** + **Recharts** (`dataviz` skill'i) + **xterm.js** (web terminal) |
| Veritabanı | **SQLite** (Node yerleşik `node:sqlite`), volume'da kalıcı |
| Arka plan işler | **Ayrı Node worker process** (aynı container) + SQLite job kilidi |
| Docker | **dockerode** (`/var/run/docker.sock`) + `docker compose` CLI |
| Sistem metrik | **systeminformation** (host mount) |
| Auth | **Çoklu kullanıcı + RBAC (admin/kullanıcı/izleyici) + session cookie + audit log** |
| Bildirim | **Telegram** + **Home Assistant** (`notify.mobile_app_*`) + **ntfy / Discord / e-posta** + uygulama içi olay merkezi |
| Dışa açılma | **Prometheus `/metrics`** + **MQTT** yayını (veri kilitlenmesi olmasın) |
| Reverse proxy | **Nginx Proxy Manager** veya **Caddy** (panelden yönetilir, otomatik Let's Encrypt) |
| Uzaktan erişim | **Tailscale** (peer durumu, key expiry takibi, Serve/Funnel ile port açmadan yayınlama) |
| Yedekleme | **restic** (+ opsiyonel rclone off-site) — panelden zamanlanır ve geri yüklenir |
| Şifre kasası | ~~Vaultwarden entegrasyonu~~ — kapsam dışı (app store'da şablon olarak duruyor) |
| Host verisi/işlemleri | **Host cron script'leri** (JSON durum) + **host-side helper** (güç/systemd/firewall vb. whitelist) |

### ⚠️ Güvenlik Notu
Web terminal, güç, firewall, dosya yöneticisi, compose gibi özellikler **yüksek yetki** ister. Bu yüzden: **RBAC** ile her yetkili işlem role bağlı, **audit log**'a yazılır. Host'ta çalıştırılan komutlar container'a doğrudan root vermek yerine **whitelist'li host-helper** üzerinden geçer (whitelist host tarafında, container'ın erişemediği bir dosyada — T4).

**HTTPS baştan zorunlu.** Panel LAN'de diye düz HTTP kabul edilemez: ev ağı güvenli değildir (IoT cihazlar, misafir telefonları, ele geçirilmiş bir TV aynı ağdadır) ve web terminal (M1.9) ile güç yönetimi (M1.13) Faz 1'de geliyor. Bu yüzden **self-signed sertifikayla HTTPS M0.2'de kurulur**; M2.8'deki reverse proxy bunu Let's Encrypt'e yükseltir. Faz 1 boyunca hiçbir yetkili işlem şifresiz taşınmaz.

---

## Mimari Kararlar (Temeller)

Bunlar özellik değil, **M0'da verilmesi gereken kararlar**. Sonradan eklenmeleri büyük refactor demektir.

### T1 — Metrik saklama & downsampling
5 saniyede bir metrik yazımı SQLite'ı aylar içinde şişirir. Katmanlı saklama (aşağıdaki değerler **varsayılandır**, `monitoring.retention.*` ayarlarıyla panelden değiştirilir — T9):

| Katman | Çözünürlük | Saklama (varsayılan) |
|---|---|---|
| `metrics_raw` | `monitoring.collect_interval` (5 sn) | 24 saat |
| `metrics_1m` | 1 dakika | 7 gün |
| `metrics_1h` | 1 saat | 90 gün |
| `metrics_1d` | 1 gün | 24 ay |

Rollup + budama, job runner'ın periyodik görevi. Grafik API'si istenen zaman aralığına göre doğru tabloyu seçer. Saklama süresi kısaltıldığında fazla veri bir sonraki budama turunda silinir. Ham çözünürlük toplama aralığına eşittir; kullanıcı toplama aralığını 60 sn'ye çıkarırsa `metrics_1m` katmanı fiilen ham veriyle aynı olur — bu durumda rollup onu atlar (kopya tablo üretmez).

### T2 — Arka plan job runner
Next.js API route'larında güvenilir zamanlanmış iş çalışmaz. **Aynı container'da ayrı Node worker process** (`next start` + `node worker.js`, basit supervisor). Tek-instance garantisi için SQLite'ta `job_locks` tablosu (lease + TTL). `jobs` / `job_runs` tabloları: son çalışma, süre, hata, sonraki tetik. Tüm periyodik işler buradan geçer: metrik toplama, rollup/budama, health-check, cron JSON okuma, ağ tarama, yedekleme, CVE tarama, log toplama. **Zamanlamaların hiçbiri koda yazılmaz — hepsi ayarlardan okunur (T9)**; ilgili ayar değişince job anında yeniden zamanlanır.

### T3 — Secret şifreleme
GitHub PAT, HA token, Telegram token, restic repo parolası düz metin tutulamaz. `MASTER_KEY` env değişkeni → **AES-256-GCM**. `settings` tablosunda `value_encrypted` + `iv` + `auth_tag`. Anahtar dönüşü için tüm secret'ları yeniden şifreleyen bakım komutu. Şifreli ayarlar T9 şemasında `type: 'secret'` ile işaretlenir; API bunları asla düz metin döndürmez.

**Şifrelemenin sınırı — açıkça bilinmeli.** Bu şifreleme **yalnızca DB dosyası tek başına sızarsa** korur (yanlış paylaşılan yedek, çalınan disk). `MASTER_KEY` ile DB aynı yedeğe girerse koruma sıfırdır. Bu yüzden: **yedekleme `.env` dosyasını ve compose'u bilinçli olarak hariç tutar** (M3.4), `MASTER_KEY` panel dışında ayrı saklanır. Anahtarı Vaultwarden'a koymak **dairesel bağımlılık** yaratır (kasa geri yüklenemezse anahtar da yok) — kağıt/harici kopya tercih edilmeli.

### T4 — host-helper protokolü
Container'a root vermek yerine host'ta küçük bir daemon çalışır; **Unix domain socket** (`/run/panel-helper/panel-helper.sock`) container'a **dizin olarak** mount edilir. İstekler **HMAC-SHA256 imzalı JSON** (paylaşılan sır env'den) + komut whitelist'i + her çağrı audit log'a. SSH kullanılmaz. Protokol M0.6'da tanımlanır, ilk implementasyon M1.13'te.

**Whitelist host tarafındadır — container onu değiştiremez.** Komut listesi `/etc/panel-helper/allow.conf` dosyasında, root'a ait, container'a **mount edilmez** ve env üzerinden geçirilmez. Aksi halde tüm model çöker: container ele geçirilirse saldırgan whitelist'i genişletip host'ta istediğini çalıştırır. Helper her isteği kendi dosyasındaki listeye göre doğrular; container yalnızca "şu komutu çalıştır" diye *rica eder*.

### T5 — SQLite eşzamanlılık
WAL modu, `busy_timeout`, yazma işlemlerinin mümkün olduğunca worker process'te toplanması. Panelin kendi DB'si için `VACUUM INTO` ile online yedek.

### T6 — Auth sertleştirme
Login rate limit (IP + kullanıcı bazlı), hesap kilitleme, **CSRF koruması** (double-submit cookie) tüm mutasyon endpoint'lerinde, login sonrası session rotation.

### T7 — Multi-host şema hazırlığı
Bugün tek sunucu, ama: `hosts` tablosu (id, name, address, agent_type, is_local) + **tüm kaynak ve zaman serisi tablolarında `host_id INTEGER NOT NULL DEFAULT 1`**. UI tek host varken host seçiciyi gizler. `lib/` katmanında metrik/docker erişimi host'a göre soyutlanır. Bugünkü maliyeti ~sıfır; ileride ajan eklemeyi refactor'suz kılar.

### T8 — CI
GitHub Actions: `tsc --noEmit` + `next build` + `docker build`. Her commit'te çalışır; sunucuya bozuk imaj gitmesini önler.

### T9 — Şema-güdümlü ayar sistemi
Eşik, aralık, limit, saklama süresi ve sıklık değerlerinin hepsi panelden ayarlanabilir olacak — 100+ ayar demek. Her ayar için ayrı form alanı, ayrı doğrulama, ayrı migration yazmak sürdürülemez. Bu yüzden **tek bir şema**: `src/settings.schema.ts`.

```ts
{
  key: 'monitoring.retention.day_months',
  group: 'monitoring',
  type: 'int',            // int | float | bool | string | enum | duration | cron | path | secret | list
  default: 24,
  min: 1, max: 120, unit: 'ay',
  label: 'Günlük metrik saklama',
  help: '1 günlük çözünürlüklü metrikler kaç ay saklansın',
  role: 'admin',          // görüntüleme/değiştirme için gereken rol
  scope: 'global',        // 'global' | 'overridable'
  onChange: 'reschedule:metrics-rollup',
  restartRequired: false
}
```

**Ayarlar ekranı bu şemadan otomatik render edilir** (tip→widget: int→sayı+birim, enum→select, cron→cron editörü + "sonraki çalışma" önizlemesi, secret→maskeli alan). Yeni ayar eklemek = şemaya bir satır; UI, doğrulama ve audit bedava gelir.

**Kategoriler ayrı sayfalardır.** Her ayar grubu `/settings/<grup>` adresinde durur; route parçası doğrudan şemadaki grup anahtarıdır, yani şemaya yeni bir kategori eklemek yeni bir sayfayı ve sol menüdeki alt maddeyi de getirir. Büyük kategoriler `SettingDef.section` ile alt başlıklara ayrılır (alt başlık sırası şemadaki ilk görünüme göre belirlenir). Arama bulunulan kategoride çalışır, diğer kategorilerdeki eşleşmeleri de sayıp bağlantı olarak sunar.

**Depolama ve çözümleme.** `settings` tablosu yalnızca **varsayılandan sapanları** tutar:
```
settings(key, scope_type, scope_id, value,
         value_encrypted, iv, auth_tag, updated_at, updated_by)
```
`scope_type`: `global` | `host` | `container` | `volume` | `app` | `repo`.
Çözümleme sırası: **kaynak ezmesi → global ezme → şema varsayılanı**. Böylece "genelde gecelik yedek, ama şu container haftalık" mümkün olur.

> Not: Bu tabloda ayrı bir `host_id` kolonu **yoktur** — host kapsamı `scope_type='host'` + `scope_id` ile ifade edilir. İki mekanizma aynı şeyi anlatmamalı (T7 ile çakışmayı önler).

**Eşik ve kural kaynağı tektir.** Alarm eşikleri, health-check aralıkları ve yedek politikaları **yalnızca ayarlarda** yaşar; ayrı bir `alert_rules` tablosu yoktur. "Bu container'ın disk eşiği farklı olsun" ihtiyacı kaynak ezmesiyle karşılanır. Böylece aynı değerin iki yerde tanımlanıp çelişmesi mümkün olmaz.

**Env tohumlama.** İlk açılışta env'de karşılığı olan ayarlar DB'ye **bir kez** yazılır; sonrasında env yok sayılır ve panelden yapılan değişiklik otoriterdir (UI'da "env'den tohumlandı" rozeti). İstisna: `MASTER_KEY`, `HELPER_SECRET`, port, socket/mount yolları — bunlar ayar değil **dağıtım parametresidir**, yalnızca env'de kalır.

**Davranış kuralları:**
- Doğrulama sunucu tarafında şemadan zorlanır (API ve UI aynı şemayı kullanır).
- Her değişiklik `audit_log`'a eski→yeni değerle yazılır; secret'lar maskeli.
- `onChange` kancası ilgili job'ı yeniden zamanlar / önbelleği düşürür. Restart gerektiren ayarlar UI'da işaretli.
- **Varsayılana dön** (tekil ayar ve grup bazlı) — ilgili override satırı silinir.
- Ayarların JSON export/import'u; M2.13 yedekleme export'una dahil.
- Ayarlar ekranında anahtar/etiket/yardım metni üzerinde arama (100+ ayar için şart).

### T10 — Geliştirme modu (mock/fixture)
Bu projenin en büyük pratik riski **geliştirme döngüsü**: kod Windows'ta yazılıyor, sunucuya ağdan erişim yok, her değişiklik `commit → push → sunucuda pull → build → gözle test` demek. Bir buton hizasını düzeltmek dakikalar alır. Ayrıca `better-sqlite3` ve `node-pty` native modüldür; Windows'ta yerel çalıştırmak ayrıca sorunludur.

Çözüm: **`MOCK_MODE=1`** ile dış dünyaya dokunan her katman sahte veri döndürür — dockerode, systeminformation, host-helper, restic, ağ tarama, GitHub API. `lib/` içindeki her entegrasyon modülü tek bir arayüz arkasında durur ve mock uygulaması `fixtures/` altındaki JSON'lardan beslenir. Böylece **tüm UI, ayarlar, grafikler ve akışlar Windows'ta `npm run dev` ile geliştirilebilir**; sunucuya yalnızca gerçek entegrasyon testi için gidilir.

Bu M0.1'de kurulur — sonradan eklemek her modüle geriye dönük arayüz açmak demektir. Mock verisi ayrıca CI'da (T8) duman testi için kullanılır.

### T11 — Migration ve geri alma
Migration'lar ileri yönlüdür ve numaralandırılır. Her migration çalışmadan **önce** panel kendi SQLite'ının `VACUUM INTO` kopyasını `data/backups/pre-migration-<n>.db` olarak alır; migration hata verirse uygulama açılmayı reddeder ve konsolda geri dönüş komutunu yazar. Geri alma "down" script'i ile değil, **bu kopyadan geri yükleme** ile yapılır — homelab ölçeğinde down script'lerini doğru yazmak ve test etmek maliyeti karşılamaz.

---

### T12 — Dış API sözleşmesi
`Authorization: Bearer` ile çağrılan, çerezsiz, sürümlenmiş `/api/v1` yüzeyi.
Dört karar:

**Ayrı `/api/v1` ad alanı, mevcut 78 ucu açmak yerine.** İç uçların yanıt
şekilleri ekranların ihtiyacına göre yazıldı ve ekranla birlikte değişiyor
(`/api/docker/[id]/action` yanıtında TÜM docker özetini döndürüyor, çünkü ekran
onu tazeliyor). Dışa açılsalardı fiilen kamusal sözleşmeye dönüşür, bir UI
değişikliği dış istemcileri kırardı. `src/lib/apiv1/serialize.ts` zorunlu geçiş
noktası: **v1 route'u asla iç view nesnesini `Response.json`'a vermez** ve
oradaki tipler `Pick<>` ile türetilmez, elle yazılır — türetilmiş bir tip iç
model değişince sözleşmeyi sessizce değiştirir ve `tsc` bunu göremez.

**Token yetkisi = RBAC kesişimi, ayrı bir kapsam sözlüğü değil.** Token bir
kullanıcıya bağlı ve o kullanıcının izinlerinin alt kümesini taşıyor; kesişim
HER İSTEKTE alınıyor. Token satırındaki liste bir tavan, bir bağış değil —
kullanıcının rolü daraltılınca token da anında daralır. Oturumlar bu sorunu
`destroyAllSessionsForUser` ile çözüyor; token'ın oturumu olmadığı için çözüm
çalışma zamanına taşındı. İkinci bir yetki sözlüğü, iki yerde tutulan ve
zamanla ayrışan bir tanım üretirdi.

**`api.enabled` ana şalteri `guardV1`'in İÇİNDE.** Route başına yazılsaydı bir
gün biri yeni bir uç ekleyip unuturdu ve şalter kapalıyken açık kalan tek bir
uç, şalterin tamamını anlamsız kılardı. İndeks dâhil her v1 ucu buradan geçmek
zorunda. Kapalıyken yanıt `404` — kapalı bir API'nin var olduğunu bile
söylememek gerekir. `/metrics` hiyerarşik olarak buna bağlı:
`api.enabled AND integration.prometheus.enabled`.

**v2'ye kadar kırıcı değişiklik yasağı.** Ayrı ad alanının tek amacı bir söz
vermek; söz yazılı değilse ad alanı dekordan ibaret. Kırıcı olan: alan
kaldırmak, yeniden adlandırmak, tipini değiştirmek, zorunlu parametre eklemek,
durum kodu değiştirmek. Eklemeler serbest ve karşılığında istemciye bir
yükümlülük düşer (`docs/API.md`): bilinmeyen alanlar yok sayılır, bilinmeyen
enum değerleri çökmeye sebep olmaz. v2 gelirse v1 `Deprecation`/`Sunset` (RFC
8594) başlıklarıyla en az bir yayın hattı yaşar.

`hostId` her kaynak şeklinde BUGÜNDEN var ve hep `1` dönüyor (T7). Alanı
sonradan eklemek kırıcı değil ama ANLAMINI sonradan değiştirmek — "bu liste
artık tüm host'ları kapsıyor" — kırıcı olurdu.

Sözleşmenin makine okunur ikizi `docs/openapi.yaml`; CI hem geçerliliğini
(`redocly lint`) hem de kodla uyuştuğunu (`npm run check:openapi`) doğruluyor.

### T13 — Port sahipliği ve güvenlik duvarının sınırı
İki karar, ikisi de "gerçeği söyle, damga vurma" kuralının uzantısı.

**Port sahipliği cgroup'tan çözülür, helper'a yeni izin açılmaz.** "Bu portu
kim tutuyor" sorusunun cevabı üç kaynağın önceliğidir: sürecin
`/proc/<pid>/cgroup` yolundaki container id, Docker'ın yayınladığı hostPort
eşlemesi, ve yine cgroup yolundaki systemd birim adı. Tek bir dosya hem
container'ı hem servisi verdiği için `systemctl show --property=MainPID` gibi
bir helper eylemine gerek kalmıyor — reddedilen alternatif buydu ve her port
için ayrı bir helper turu artı `allow.conf`'ta yeni bir satır demekti.
Kazanç yalnızca maliyet değil: `network_mode: host` çalışan container'lar hiç
port YAYINLAMADIĞI için hostPort eşlemesiyle asla bulunamıyorlardı, cgroup
onları da yakalıyor.

⚠️ **Ama cgroup'u okumak tek başına YETMİYOR ve bu ilk turda gözden kaçtı.**
Soketi sürece bağlayan adım `/proc/<pid>/fd` sembolik bağlarını okumaktır;
dizini LİSTELEMEK serbest, bağı OKUMAK ise hedef sürece ptrace erişimi ister.
Tarama container'ı bu erişime sahip olmadığı için host süreçlerinin (sshd,
tailscaled, docker-proxy, systemd) fd'lerini okuyamıyor, dolayısıyla systemd
birimi eşlemesi HİÇ çalışmıyordu. Geçici container artık `SYS_PTRACE` ve
AppArmor muafiyetiyle açılıyor — **ikisi birlikte**, çünkü Docker'ın varsayılan
AppArmor profili ptrace'i "aynı profildeki süreçler" ile sınırlıyor ve tek
başına yetenek vermek işe yaramıyor. Ölçüm için bkz. aşağıdaki retro.

**"Boş port" sorusunun doğru cevabı, DURMUŞ container'ları da meşgul saymaktır.**
Kullanıcının sorduğu şey "şu an kimse dinlemiyor mu" değil, "bu portu verirsem
çakışır mı". Durmuş bir container'ın yayınladığı port bugün boş görünür ve o
container başlatıldığında Docker "port is already allocated" der. Bu yüzden
rezerve kümesi `list(true)` üzerinden kuruluyor ve durmuş sahipler ekranda
ayrıca etiketleniyor.

**ufw'nin Docker'ı engelleyemediği gerçeği gizlenmez.** Docker kendi iptables
kurallarını `DOCKER-USER` zincirine ve nat `PREROUTING`'e yazar; bunlar ufw'nin
`filter INPUT` zincirinden önce çalışır. Yayınlanmış bir container portuna
yazılan `deny` kuralı ETKİSİZDİR. Panel bu kuralları gizlemiyor ya da yazmayı
engellemiyor — yanına "ufw atlanıyor" rozeti koyuyor. Alternatif (kuralı
sessizce kabul etmek) kullanıcıya olmayan bir güvenliği varmış gibi sunardı ki
bu, yanlış veriden daha tehlikelidir.

**Kilitleme koruması onaya bağlıdır, yasağa değil.** `ufw enable`, kural
listesi eksik bir sunucuda SSH dahil her şeyi keser ve fiziksel erişim dışında
dönüş yolu bırakmaz. Panel bunu engellemiyor; kural listesinde SSH'ın, kendi
portunun (`PANEL_HTTPS_PORT`/`PANEL_HTTP_PORT` — sabit 443 değil) ve Docker alt
ağının bulunup bulunmadığına bakıp NEYİN kesileceğini adıyla söylüyor ve onay
istiyor. Son söz izin listesinindir: `ufw.enable` `allow.conf`'ta ayrı bir
satırdır ve açılmadıkça panel bu düğmeye basamaz.

### T14 — Compose dosyası panelin düzenleyebileceği bir kaynaktır
M1.8'de env/port düzenlemesi **Docker API'siyle** yapılmadığı için reddedilmişti:
compose ile yönetilen bir container'da böyle bir değişiklik ilk `compose up`'ta
geri alınır ve o notta doğru yer olarak M1.12 işaretlenmişti. T14 o boşluğu
kapatıyor: panel container'ı değil, container'ın geldiği **compose dosyasını**
düzenliyor ve `compose up -d` ile uyguluyor. Aynı düğme, kalıcı sonuç veren
hâliyle.

**Yorumlar korunur, dosya yeniden biçimlendirilmez.** `yaml` paketinin Document
API'si kullanılıyor, `parse`/`stringify` ikilisi değil — ikincisi belgeyi düz
nesneye çevirip yeniden ürettiği için yorumları, anahtar sırasını ve tırnak
biçimini kaybediyor. Tek bir portu değiştirmek için kullanıcının dosyasını
baştan aşağı yeniden yazmak, diff'i okunamaz hâle getirir ve düzenlemeyi
denetlenemez kılar. Aynı sebeple port yazım biçimi de korunuyor: kısa yazılmış
bir port kısa kalıyor, ayrıştırılamayan satırlar (aralık, `${DEĞİŞKEN}`) ham
taşınıp düzenlemeye kapatılıyor — anlamadığı satırı düşüren bir düzenleyici,
kullanıcının yayınını sessizce kapatır.

**"Asla üzerine yazma" kuralı, sessizliğe karşıydı.** M3.10'da kurulum için
konan kuralın gerekçesi `install.ts`'te yazılı: *"çalışan bir yığının
compose'unu SESSİZCE değiştirmek olurdu."* Düzenleme akışı bu itirazın
koruduğu şeyi koruyor — diff önden gösteriliyor, yedek alınıyor
(`<dosya>.panel-yedek-<zaman>`, sayısı ayardan), `compose config` ile
doğrulanıyor ve **doğrulama başarısızsa yedek geri yükleniyor**. Bozuk bir
compose dosyası bırakmak kabul edilebilir en kötü sonuç değil, kabul edilemez
olan.

**Yazma yetkisinin sınırı `files.roots` değil, Docker'ın kendi etiketleri.**
Düzenlenecek dosyanın yolu istemciden alınmıyor; container'ın
`com.docker.compose.project.config_files` etiketinden çözülüyor. Böylece panel,
gerçekten çalışan bir compose projesinin kendi bildirdiği dosyası dışında
hiçbir yere yazamıyor — dosya yöneticisinin ayarına bağlanmadan, kendi başına
duran bir kısıt.

**Ön kontroller üç seviyeli: engel / uyarı / öneri.** Panelin başka
yerlerdeki duruşuyla aynı (M3.7'de port listesine "tehlikeli" damgası vurulmuyor,
M3.18'de güvenlik duvarı değişikliği engellenmiyor onay isteniyor). Tanımsız
`${DEĞİŞKEN}` kontrolü **bilerek yapılmıyor**: onun tek doğru kaynağı `compose
config`'in kendisi — `.env`'i, kabuk ortamını ve `${VAR:-varsayılan}` söz
dizimini o biliyor. Panelin ikinci bir tahmin yürütmesi yanlış alarm üretirdi.

## Geliştirme İş Akışı & Yol Haritası

**İş akışı:** Kod bu makinede (Windows) yazılır → commit → `git push origin` (GitHub, kanonik) + `git push server` (sunucuya doğrudan dağıtım) → sunucuda `docker compose up -d --build` → **doğrulama SSH üzerinden yapılır**. Her milestone bir commit + sunucuda gerçek doğrulama.

> **Güncelleme (M0.2):** Sunucuya bu makineden SSH erişimi **var** (`coraspirin@192.168.61.114`, ayrıca Tailscale `100.77.244.55`). Planın ilk halindeki "LAN IP'sine erişilemiyor, doğrulamayı kullanıcı yapar" varsayımı geçersiz. Doğrulama artık otomatik yapılabiliyor.
>
> Sunucuda GitHub kimlik bilgisi olmadığı için (`git pull` çalışmıyor, depo private) dağıtım **push-to-deploy** ile yapılır: sunucudaki çalışma kopyasında `receive.denyCurrentBranch=updateInstead` açık, `git push server master` çalışma ağacını doğrudan günceller. GitHub'a deploy key eklenirse klasik `git pull` akışına dönülebilir.

**İlkeler:** (1) deploy hattını en baştan doğrula, (2) dikey dilimler — her milestone bağımsız test edilebilir, (3) ortak altyapı (auth/audit, ayarlar, job runner, health-check, bildirim/olay) bağımlı özelliklerden önce, (4) en yetkili/riskli parçalar çekirdek oturunca, (5) **her milestone kendi ayarlarını `settings.schema.ts`'e ekler — eşik, aralık, limit, saklama süresi ve sıklık değerleri koda sabit yazılmaz** (T9).

### M0 — Temel İskelet (tüm fazların önkoşulu)
- **M0.1** ✅ Next.js 16 + TS + Tailwind 4 scaffold, layout/navigasyon (yol haritasını gösteren yer tutucu ekranlar), `/api/health` + **`MOCK_MODE` iskeleti ve `fixtures/`** (T10) → Windows'ta `npm run dev` ile geliştirilebilir taban.
- **M0.2** ✅ Dockerfile (standalone, Debian slim, root olmayan kullanıcı, healthcheck) + docker-compose (docker.sock, host mount `/proc`+`/sys`, volume) + **Caddy ile HTTPS** (`tls internal`, panel container'ı dışarıya port açmaz — tek giriş `:8443`) + **CI** (T8: typecheck/lint/build + imaj derleme + container duman testi) → **sunucuda HTTPS ile açılıyor** (deploy hattı doğrulandı). Kurulum ve doğrulama adımları: `DEPLOY.md`.
- **M0.3** ✅ SQLite + migration altyapısı **+ migration öncesi otomatik DB kopyası** (T11) + **`hosts` tablosu / `host_id` konvansiyonu** (T7) + **metrik katman tabloları** (T1) + WAL/eşzamanlılık (T5). Sürücü olarak `better-sqlite3` yerine **Node'un yerleşik `node:sqlite`'ı** seçildi: native derleme gerekmediği için Windows geliştirme ile Linux container arasında ayrışma yok (node-gyp/prebuild/musl derdi yok). Ödünü: modül Node dokümanlarında hâlâ "experimental"; bu yüzden tüm DB erişimi `lib/db/client.ts` arkasında toplandı, gerekirse sürücü değişimi tek dosyalık iş.
- **M0.4** ✅ **Auth çekirdeği:** çoklu kullanıcı + **rol/izin modeli** (`roles` + `permissions` + `role_permissions`; admin/kullanıcı/izleyici hazır rol olarak tohumlanır, özel rol M3.1'de UI kazanır) + session + `middleware.ts` + **audit log** + **rate limit / hesap kilitleme / CSRF** (T6) + **secret şifreleme altyapısı** (T3) + tema.
- **M0.5** ✅ **Ayarlar altyapısı + ekranı:** `settings.schema.ts`, çözümleme motoru (kaynak→global→varsayılan), env tohumlama, şemadan otomatik render edilen Ayarlar ekranı (gruplandırma + arama + varsayılana dön), audit entegrasyonu (T9).
- **M0.6** ✅ **Arka plan job runner + host-helper sözleşmesi:** worker process, `jobs`/`job_runs`/`job_locks`, job durum ekranı, **zamanlamalar ayarlardan okunur + `onChange` ile yeniden zamanlama**; socket+HMAC protokol tanımı (T2, T4).
- **M0.7** ✅ **M0 doğrulama → KAPI: onay.** Sunucuda HTTPS ile açılıyor; migration çalışıyor ve öncesinde otomatik DB kopyası düşüyor; login+RBAC+audit; Ayarlar ekranı şemadan render oluyor ve bir ayar değişikliği job'ı yeniden zamanlıyor (`login_max_attempts` 5→3 kilitlemeyi 3. denemeye çekti; cron değişikliği `next_run_at`'i taşıdı); oturumsuz istekler 401/307 alıyor; `MOCK_MODE` ile Windows'ta aynı UI açılıyor.

### FAZ 1 — İzleme & Docker/Sistem Yönetimi
- **M1.1** ✅ **Sistem metrikleri + İzleme ekranı + rollup/budama job'ı (T1).** `MetricsProvider` (T10) host `/proc`+`/sys`'ten okur; `metrics.collect` işi ayarlardaki aralıkta tek işlemde ~20 örnek yazar, `metrics.rollup` işi 1dk→1sa→1gün katmanlarını `sample_count` ağırlıklı üretir ve saklama sürelerini uygular. Grafik API'si katmanı istenen aralığa göre seçer (1 sa→ham, 24 sa→1dk, 30 g→1sa, 1 y→1gün). İzleme ekranı: 6 özet kartı, disk bölümü çubukları ve 5 grafik (bağımlılıksız SVG; toplanmış katmanlarda min–max bandı).
  - **Not (dağıtım):** disk doluluğu için host kökü `/host/root` altına salt-okunur mount edildi — `statfs` gerçek bir yol ister, hiçbir `/proc` dosyası doluluk vermez. Bu, mevcut yetki sınırını genişletmiyor (aynı container zaten `docker.sock` görüyor) ama compose'da açıkça belgelendi; docker.sock'suz bir kurulumda yalnızca izlenecek bölümler tek tek mount edilebilir.
  - **Not (T10):** sahte metrik üreteci zamanın **saf fonksiyonu** olarak yazıldı; böylece `MOCK_MODE`'da geçmiş de üretilebiliyor ve 30 gün / 1 yıl grafikleri ile katman seçimi veri birikmesini beklemeden sınanabiliyor.
  - **⚠️ Tuzak — sonraki milestone'lar için geçerli:** `/proc/mounts` ve `/proc/net/dev` aslında `/proc/self/...` bağıdır; host'un `/proc`'u container'a mount edilse bile **okuyan process'in namespace'ini** çözerler. İlk sürümde bu yüzden disk metriği hiç üretilmedi (mount tablosu yalnızca `overlay /` gösterdi) ve ağ grafiği container'ın eth0'ını çizdi. Doğrusu **PID 1 üzerinden okumak**: `/host/proc/1/mounts`, `/host/proc/1/net/dev`. Aynı tuzak M1.4 (sensör/S.M.A.R.T) ve M3.3 (journald) için de geçerli olacak.
- **M1.2** ✅ **Health-check + uptime altyapısı:** `monitors` (`http|tcp|ping|dns|container`) + `uptime_log` + `maintenance_windows`; aralık/timeout/deneme/eşik `health.*` ayarlarından gelir ve monitör bazında ezilebilir. Yeni ekran: **Servis Durumu** (`/uptime`) — durum satırları, 60 günlük kullanılabilirlik şeridi, 24 sa / 30 g yüzdeleri, "şimdi kontrol et", ekle/düzenle/sil, bakım penceresi yönetimi. Faz 2'de `apps` kayıtları buna bağlanır (M2.3).
  - **`uptime_log` yalnızca durum DEĞİŞİMLERİNİ tutar**, her kontrolü değil: 60 sn aralıkta her kontrolü yazmak monitör başına yılda ~525 bin satır demekti, oysa bir servis günlerce aynı durumda kalır. Kullanılabilirlik yüzdesi ve kesinti süresi değişim günlüğünden birebir hesaplanıyor.
  - **Gecikme ayrı tabloya yazılmıyor:** `monitor.latency` metriği olarak `metrics_raw`'a gidiyor ve T1'in rollup/budama/grafik hattını olduğu gibi kullanıyor.
  - **Flap koruması iki katmanlı:** aynı turda `retries` (anlık paket kaybı), turlar arasında `down_threshold` ardışık hata eşiği.
  - **⚠️ Dağıtım engeli 1 — docker.sock izni:** panel root olmayan kullanıcıyla çalıştığı için soketi okuyamıyordu (`EACCES`). Compose'da `group_add` ile host'un docker grubuna eklendi (`DOCKER_GID`). M1.6 buna zaten muhtaçtı.
  - **⚠️ Dağıtım engeli 2 — ufw:** container'dan **host'un kendi portlarına** giden paketler düşürülüyor. Yayınlanmış container portları (DNAT), aynı ağdaki container'lar (DNS adıyla) ve dış adresler çalışıyor; host ağındaki servisler (Home Assistant `:8123`, Mosquitto `:1883`) zaman aşımına uğruyor. Panel alt ağı `PANEL_SUBNET` ile **sabitlendi** ki güvenlik duvarı kuralı ağ yeniden oluşturulunca geçersizleşmesin; port bazlı izin komutları `DEPLOY.md`'de. **Bu bir host politikası kararıdır — kullanıcı onayı gerekir.**
- **M1.3** ✅ **Bildirim motoru + olay kaydı + alarm bastırma.** `events` + `alert_state`; beş kanal (Telegram, Home Assistant, ntfy, Discord, e-posta) her biri kendi seviye filtresiyle. Yeni ekran: **Olaylar** (`/events`) — kanal durumları, deneme bildirimi, olay listesi, bastırma sebebi, okundu işaretleme. (M3.2 bunun üstüne zaman çizelgesi ve audit birleşimini kuracak.)
  - **Dört koruma, tek gerekçe:** yanlış alarm yağdıran sistem kısa sürede susturulur ve gerçek arıza da kaçar. (1) *Flap* — durum `alerts.flap_threshold` tur üst üste aynı kalmadan bildirilmez. (2) *Dedup* — aynı sorun `alerts.dedup_window` içinde tekrarlanmaz; seviye yükseliyorsa ve "çözüldü" haberinde beklenmez. (3) *Bakım penceresi + sessiz saatler* — bildirim susar, olay yine kaydedilir ve **neden susturulduğu yazılır**. (4) *Tırmandırma* — çözülmeyen kritik alarm `alerts.escalate_after` sonra hatırlatılır, okundu işaretlenince durur.
  - **`alert_state`'te iki ayrı kolon** (`last_notified_severity` / `last_event_severity`): bastırılan bir alarm günlüğe bir kez düşmeli ama "bildirildi" sayılmamalı — tek kolonla ya olay her turda tekrarlanır ya da pencere kapanınca bildirim hiç gitmez.
  - **Yaşanmış iki hata:** (a) "çözüldü" haberinin seviyesi `ok` olduğu için her kanalın en düşük seviyesinin altında kalıyordu — hiçbir kurtarma bildirimi gönderilemiyordu; artık **arızanın** seviyesine göre süzülüyor. (b) Bildirim gitmemişse kurtarma günlüğe de düşmüyordu, panelde arıza satırı asılı kalıyordu.
  - **CPU eşiği anlık örnekle değil son 5 dakikanın ortalamasıyla** değerlendiriliyor; tek bir derleme ya da yedekleme her seferinde alarm üretmesin.
  - Bağımlılık: **nodemailer** (SMTP). Elle SMTP yazmak ~150 satır ve doğrulanamayan bir risk; alarmın gitmesi kritik olduğu için savaş görmüş kütüphane tercih edildi.

- **M1.4** ✅ **Donanım sağlığı.** Sıcaklık (`/sys/class/hwmon`) ve mdraid (`/proc/mdstat`) doğrudan panelden okunur — salt-okunur dosyalar, ek yetki gerekmez. **S.M.A.R.T ve ZFS ise host'ta çalışan `scripts/hardware.sh`'ten gelir**: `smartctl` ham disk erişimi (`CAP_SYS_RAWIO`), `zpool` host araçlarını ister; bunları container'a vermek, paneli okuyabilsin diye tüm disklere ham erişim açmak demekti (T4). Script sonucu JSON bırakır, panel **yalnızca okur**.
  - **Sıcaklık eşiği önce SENSÖRÜN KENDİ eşiğini kullanır:** bir NVMe'nin 74 °C'si normal, bir CPU'nun 74 °C'si sınırdadır. Tek global eşik ikisini de yanlış değerlendirirdi; sensör eşik bildirmiyorsa ayardaki değer devreye girer.
  - Yeniden atanan / bekleyen sektör > 0 → uyarı (disk henüz arızalı değil, bozulmaya başlıyor); `FAILED` → kritik. Rapor eskirse ayrıca uyarılır — sessizce eski S.M.A.R.T verisi göstermek, hiç göstermemekten kötüdür.
  - **Sanallaştırma algılanır.** Bu sunucu bir **Hyper-V VM'i**: sanal diskte S.M.A.R.T, sanal anakartta sensör yoktur. Panel boş kutu göstermek yerine sebebini yazar.
  - **⚠️ Doğrulama sınırı:** sunucu sanal olduğu için sıcaklık/S.M.A.R.T/RAID yolları **canlı doğrulanamadı**; MOCK_MODE fixture'larıyla sınandı (eşik mantığı, sayaç uyarısı, havuz durumu, rapor eskimesi).
- **M1.4 (özgün)** Donanım sağlığı (sıcaklık + S.M.A.R.T, `scripts/smart.sh`) **+ RAID/ZFS havuz durumu** (`mdadm --detail` / `zpool status`: havuz sağlığı, **degraded/resilver → kritik alarm**, son scrub tarihi ve sonucu, scrub gecikmesi uyarısı) → alarma bağla. S.M.A.R.T tek diski görür, havuz durumu diziyi görür — biri diğerinin yerine geçmez.
- **M1.5** ✅ **Kapasite tahmini.** `metrics_1d` günlük ortalamalarına en küçük kareler doğrusu oturtulur; saatlik dalgalanma trendi bozar, günlük ortalama gerçek eğilimi verir. Üç koruma: (1) `capacity.min_history_days` kadar geçmiş yoksa **tahmin yapılmaz**, (2) uyum (R²) `capacity.min_confidence` altındaysa tahmin **gösterilir ama alarm üretmez**, (3) eğim ≤ 0 ise tahmin yok. Ufkun yarısından kısaysa kritik. Panelde her satırda kaç günlük veriye dayandığı ve uyum yüzdesi yazar.
  - Doğrulama (sentetik veri): temiz dik eğim (R² %100) → "2 gün sonra dolabilir" **kritik**; eğimsiz gürültü (R² %9) → tahmin gösterildi, **alarm yok**.
- **M1.5 (özgün)** **Kapasite tahmini & trend:** disk/RAM/CPU lineer trend projeksiyonu, "disk N gün sonra dolar" alarmı (`alerts.capacity_forecast_days`), uzun dönem trend grafiği (rollup tablolarından).
- **M1.6** ✅ **Docker container tablosu + restart-loop tespiti.** Tablo: durum/sağlık, CPU, bellek, portlar, compose stack'i, yeniden başlatma sayacı. Ölçümler ayrı bir tabloya değil **`metrics_raw`'a** yazılıyor (label = container adı) — T1'in rollup/budama/grafik hattı olduğu gibi çalışıyor **ve restart-loop tespiti bedava geliyor**: sayaç bir zaman serisi olduğu için "son 10 dakikada kaç kez arttı" tek SQL sorgusu.
  - Tablo canlı Docker çağrısı yapmaz: liste tek çağrı (hızlı), ölçümler DB'den. Ölçümü de canlı çekmek sayfa açılışını container başına ~1 sn bekletirdi (`/stats` iki örnek topluyor).
  - Bellek hesabında sayfa önbelleği düşülüyor (`docker stats`'in yaptığı gibi); yoksa dosya okuyan her container belleği doldurmuş gibi görünür. **Sunucuda `docker stats` ile birebir doğrulandı.**
  - **Doğrulama:** gerçek sunucuda `--restart=always` ile sürekli çöken bir test container'ı oluşturuldu; sayaç 8→11 izlendi, eşik dolunca kritik alarm üretildi, sonra temizlendi. Kullanıcının servislerine dokunulmadı.
- **M1.7** ✅ **Container aksiyonları + canlı log (SSE) + disk temizliği.** start/stop/restart/pause/unpause (durdurma bekleme süresi ayardan — Docker önce SIGTERM yollar, süre dolunca SIGKILL), **her aksiyon audit'e** düşer. Canlı log SSE ile; **Docker'ın çerçeveli log protokolü** (TTY yoksa `[tür][uzunluk][veri]`) çözülüyor — gerçek sunucuda stdout/stderr ayrımı ve UTF-8 Türkçe karakterlerle doğrulandı. Log penceresi: otomatik kaydırma yalnızca kullanıcı en alttayken, 2000 satır sınırı, duraklat, arama. Disk temizliği kapsam başına ne sildiğini ve geri alınabilir olup olmadığını açıkça yazar; `volumes` **veri siler** ve ayrı onay ister. Otomatik temizlik işi var ama **varsayılan kapalı**.
- **M1.6 (özgün)** Docker container tablosu (list + stats) + **restart-loop tespiti**: `RestartCount` izlenir, kısa sürede tekrar tekrar yeniden başlayan container "up" görünse bile **alarm üretir** (homelab'de en yaygın sessiz arıza).
- **M1.7 (özgün)** Container aksiyonları (start/stop/restart) + canlı loglar (SSE) + **Docker temizlik**: elle prune **ve** `docker.autoprune.*` ayarlarına bağlı **zamanlanmış otomatik prune job'ı** (varsayılan kapalı, kapsam ve yaş sınırı ayarlanabilir).
- **M1.8** ✅ **Docker derinliği + runbook.** Docker ekranı sekmelere ayrıldı (Container'lar / Image'lar / Volume'lar / Ağlar / Temizlik); kaynak listeleri yalnızca ilgili sekmeye geçilince çekilir. Container detay penceresi: healthcheck durumu ve son çıktısı, yapılandırma, mount/env, **ham inspect JSON'u**, bağımlılıklar ve runbook — hepsi tek istekte.
  - **Docker bağımlılık diye bir kavram tutmaz** (`depends_on` yalnızca compose'un başlatma sırasıdır ve container oluştuktan sonra hiçbir yerde saklanmaz), bu yüzden bağımlılık çalışan yapılandırmadan **çıkarılıyor** ve iki güçte ayrılıyor: **sert** (`network_mode: container:X`, `volumes_from` → diğeri teknik olarak çalışamaz) ve **yumuşak** (paylaşılan özel ağ, paylaşılan volume, aynı compose yığını → ayakta kalır ama işlevini kaybeder). Yumuşak ölçüt olarak `bridge/host/none` sayılmaz: varsayılan köprüdeki iki container'ın ilgisi olmayabilir, aynı compose ağındaki ikisi birbirini isimle çağırabilir.
  - **"Kullanılmıyor" damgası durmuş container'ları da hesaba katar.** Yalnızca çalışanlara bakmak, geçici durdurulmuş bir servisin volume'unu "öksüz" göstermek demekti — ve silinen volume geri gelmez. Her satırda kimin kullandığı yazılı ki kullanıcı damgayı kendisi doğrulayabilsin.
  - **Runbook notu** container **adına** bağlanır (id her recreate'te değişir, isim kalır) ve **kritik/uyarı bildiriminin gövdesine eklenir** — telefona düşen mesaj sorunu ve ilk adımı birlikte taşır. "Düzeldi" haberine eklenmez; çözülmüş bir sorunun müdahale adımları kimsenin işine yaramaz. Olay kaydına da yazılmaz (panelde zaten duruyor). Markdown görüntüleyici React düğümü olarak kuruluyor, `dangerouslySetInnerHTML` yok — notu panele erişen herkes yazabildiği için HTML enjeksiyonu yüzeyi hiç açılmadı.
  - **Restart politikası** Docker'ın `/update` ucuyla, container'ı yeniden oluşturmadan değişir. **Env/port düzenle→recreate bilinçli olarak yapılmadı:** container'ların tamamı compose ile yönetiliyor ve panelden yapılan böyle bir değişiklik ilk `compose up`'ta geri alınırdı — doğru yeri M1.12. Panel bunu kullanıcıya da söylüyor (compose'a ait container'da uyarı çıkıyor).
  - **⚠️ Gerçek kurulumda çıkan kör nokta:** Home Assistant, Mosquitto ve Zigbee2MQTT'nin üçü de **host ağında**; aralarında hiçbir Docker ağı, volume ya da compose bağı yok — oysa ikisi diğerinin MQTT istemcisi. Host ağındaki container'lar birbirine `localhost` üzerinden eriştiği için bu gerçek bir ilişki; kurallara en sonda (en zayıf sinyal olarak) eklendi. Fixture'larla yakalanamayacak, yalnızca canlı kurulumda görülebilecek bir eksikti.
  - **Sunucuda doğrulama:** 9 image / 8 volume / 7 ağ listelendi; kullanılmayan olarak 2 image (326 MB), 4 isimsiz volume ve `portainer_default` ağı bulundu. mosquitto durdurulursa → homeassistant (host ağı) + zigbee2mqtt (compose) uyarısı çıkıyor. Runbook gerçek container'a yazıldı, okundu, boş kaydedilerek silindi. `bridge` ağını silme denemesi Docker tarafından reddedildi.
  - **Doğrulama (MOCK_MODE fixture'ları):** homeassistant durdurulursa → `cirkin-servis` **sert** (ağ yığınını ondan alıyor), mosquitto + zigbee2mqtt **yumuşak**; mosquitto durdurulursa → `cirkin-servis` **sert** (`volumes_from`); pihole durdurulursa → etkilenen yok. Kullanılmayan kaynak raporu 2 image (355 MB) + 1 volume + 1 ağ buldu. Sentetik restart-loop ile üretilen **kritik alarm, gövdesinde runbook notuyla** sahte bir alıcıya gerçekten gönderildi; aynı notun olay kaydına **yazılmadığı** doğrulandı. Yerleşik ağ silme reddedildi.
- **M1.9** ✅ **Web terminal (xterm.js + Docker exec).** Container satırındaki terminal düğmesi container içinde kabuk açar; xterm.js yalnızca terminal açılınca yükleniyor (dinamik import).
  - **⚠️ WebSocket kullanılamadı:** Next 16 Route Handler'ları yükseltme yapamıyor — dokümanda açıkça yazılı ("WebSockets won't work because the connection closes on timeout, or after the response is generated"). Seçenekler özel bir HTTP sunucusu yazmak ya da akışı ikiye bölmekti; özel sunucu standalone çıktının dosya izlemesini ve Dockerfile'ın giriş noktasını değiştirmek demekti — terminal için tüm dağıtım hattını riske atmaya değmez. Bu yüzden **çıktı SSE, giriş POST**. Yerel ağda tuş başına bir POST'un gecikmesi birkaç milisaniye. Tuş vuruşları 12 ms'lik pencerede biriktiriliyor; yoksa yapıştırılan bir metin yüzlerce istek olurdu.
  - **Oturum bellekte yaşıyor:** Docker'ın hijack edilmiş soketi tek ve iki yönlü, giriş/çıkış uçları aynı sokete bağlı. İki ayrı HTTP isteğinin bunu paylaşabilmesi için soket istekler arasında yaşamalı; panel tek uzun ömürlü bir Node süreci olduğu için (job runner da buna dayanıyor) modül düzeyinde bir Map yeterli. **Sunucusuz bir ortama taşınırsa bu tasarım çalışmaz.**
  - **Güvenlik:** ayrı izin (`docker.exec`), her oturum açılışı audit'e, oturum sahibinden başkası bağlanamaz, boşta kalan oturum `docker.exec_idle_minutes` sonunda kapatılır (sekmesi kapatılan terminal container içinde kabuk bırakmasın).
  - Kabuk seçimi "otomatik"te container'ın **içinde** yapılıyor: Alpine tabanlı image'larda bash yok, sabit `/bin/bash` yazmak hata verirdi.
  - **Sunucuda doğrulama:** mosquitto (Alpine) → `sh`, homeassistant → `bash` seçildi; `id -u` her ikisinde de 0 döndü (container içinde root — panel bunu kullanıcıya da yazıyor). `exit` sonrası çıkış kodu 0 bildirildi, akış kapandı. **Yaşanmış hata:** kabuk kapandıktan sonra oturuma yapılan istekler hâlâ 200 dönüyordu (kayıt yalnızca "kapalı" işaretleniyor, silinmiyordu); artık kapanır kapanmaz 409, kısa tolerans penceresinden sonra 404.
  - Bağımlılık: **@xterm/xterm** + **@xterm/addon-fit**. Gerçek bir terminal emülatörü (ANSI kaçış dizileri, imleç adresleme, kaydırma tamponu) binlerce satır; elle yazmak M1.9'u tek başına bir projeye çevirirdi.
- **M1.10** ✅ **Bilgilendirme panelleri.** Genel Bakış'ta üç kart: işletim sistemi güncellemeleri, container image güncellemeleri, yedek takibi. Üçü de aynı soruyu farklı yerlere soruyor — *arkada sessizce bozulan bir şey var mı?* — ve üçü de alarm koşulu üretiyor; panel açılmasa da haber geliyor.
  - **Panel güncelleme KURMAZ, haber verir.** Bir çekirdek güncellemesi yeniden başlatma ister; bunu gece 3'te kendiliğinden yapan bir panel çözdüğünden çok sorun çıkarır.
  - **OS:** host'ta `scripts/os-updates.sh` JSON bırakır, panel yalnızca okur (`apt` host'un paket veritabanını ister ve root ile çalışır — `hardware.sh` ile aynı gerekçe). Rapor eskirse ayrıca uyarılır.
  - **⚠️ Güvenlik güncellemesi sayımında tuzak:** Ubuntu yamaları hem `-security` hem `-updates` havuzuna koyar; `apt-get -s upgrade` çıktısında yalnızca biri görünür (genelde `-updates`). O metne bakarak sayım yapmak, gerçek güvenlik yamalarını sıradan güncelleme göstermek demekti. `python3-apt` aday sürümün TÜM kaynaklarını verir — Ubuntu'nun kendi `apt-check` aracı da böyle yapar. Kütüphane yoksa eski yola düşülür ve rapora "sayım eksik olabilir" notu yazılır.
  - **Image:** `docker pull` DEĞİL — kayıt defterinden yalnızca manifest özeti (HEAD) istenir; pull farkı bulduğunda indirir ve Home Assistant image'ı 3 GB. Token adresi koda gömülmedi: `401` yanıtındaki `WWW-Authenticate` başlığından keşfedilir, böylece Docker Hub / GHCR / özel registry aynı kodla çalışır. Erişilemeyen image **"kontrol edilemedi"** olarak işaretlenir; sessizce "güncel" demek güvenlik yaması kaçırmaktı.
  - **Yedek:** yedekleme MOTORU M3.4'te. Burada yalnızca *"en son yedek ne zaman alındı"* sorulur — çünkü yedekleme sisteminin en sinsi arızası çökmesi değil, sessizce durmasıdır.
  - Pahalı sonuçlar için kalıcı `cache` tablosu (migration 008): image kontrolü günde bir çalışır, bellekte tutulsa her yeniden başlatmada kaybolur ve ekran bir güne kadar boş kalırdı.
  - **Sunucuda doğrulama:** 63 paket güncellenebilir bulundu; image kontrolü 7 container'ı 7 saniyede tarayıp Home Assistant ve Pi-hole için yeni sürüm buldu, yerel derlenen ikisini "kontrol edilemedi" işaretledi.
- **M1.11** ✅ **Tek-tık image güncellemesi.** Docker'da "container'ı güncelle" diye bir işlem yoktur: yeni image'ı çek, eski container'ın yapılandırmasını kopyala, yenisini oluştur, eskisini kaldır. Asıl iş yapılandırmayı kaybetmeden taşımak.
  - **Sıra önemli:** önce eskiyi DURDUR, sonra yenisini oluştur — aynı portu dinleyen iki container aynı anda ayakta olamaz.
  - **Geri alma:** eski container silinmez, yeniden adlandırılır. Yeni sürüm ayakta kalmazsa yenisi silinip eskisi eski adıyla geri başlatılır.
  - Ağ uçlarından çalışma zamanına ait alanlar (`IPAddress`, `MacAddress`, `EndpointID`) atılır — kopyalanırsa ya çakışır ya reddedilir; kullanıcının tanımladığı `Aliases`/`IPAMConfig`/`Links` korunur (servisin ağdaki adı bunlara bağlı). Docker `create` sırasında tek ağ kabul ettiği için gerisi sonradan bağlanır; atlanırsa çok ağlı bir servis yarısı erişilebilir kalırdı.
  - **Docker pull hatalarını gövdenin İÇİNDE, HTTP 200 ile döndürür.** Bunu yutmak "güncellendi" deyip eski image'la devam etmek olurdu.
  - **Sunucuda doğrulama (kullanıcının servislerine dokunulmadan):** yerel `alpine:latest` etiketi kasten eskitilip tek kullanımlık bir container güncellendi — ad, port eşlemesi, etiket ve komut korundu, image kimliği değişti, yedek temizlendi. Ardından kasten ayakta kalamayan bir container ile **geri alma** denendi: yeni container silindi, eskisi eski adı, image'ı, env'i ve etiketiyle geri geldi.
- **M1.12** ⚠️ **Compose/stack yönetimi — kod hazır, host kurulumu bekliyor.** `docker compose` bir **CLI eklentisidir**; Docker Engine API'sinde karşılığı yoktur, yani panel container'ından çağrılamaz. Bu yüzden komutlar host-helper üzerinden geçer (T4) ve hangi dizinlerde compose çalıştırılabileceğine host'taki izin listesi karar verir. Yığınların yeri tahmin edilmiyor: çalışan container'ların `com.docker.compose.project.working_dir` etiketinden okunuyor — compose dosyasının yerini kullanıcıya ayrıca yazdırmak, iki kaynağın ayrışması demekti. Ekran ve API yazıldı; **canlı doğrulama host-helper kurulumundan sonra** (M1.14).
- **M1.13** ⚠️ **Host-helper — kod hazır, kullanıcının `sudo` ile kurması gerekiyor.** T4'ün ilk implementasyonu: host'ta root olarak çalışan küçük bir daemon (`host-helper/panel-helper.py`, yalnızca Python stdlib — host'a panel için Node kurmak, azaltmaya çalıştığımız yüzeyi büyütürdü), Unix soketi, HMAC-SHA256 imza, ±30 sn zaman penceresi, tekrar koruması ve **host tarafındaki izin listesi**.
  - **Container komut STRINGI göndermez** — yalnızca bir eylem adı ve yazılı argümanlar. Çalıştırılacak komut şablonu host tarafında sabittir ve `subprocess` kabuk olmadan çağrılır; kabuk enjeksiyonu için yüzey kalmaz.
  - **İzin listesi kasten BOŞ kurulur.** Kurulum panele hiçbir yetki vermez; hangi eylemin açılacağına kullanıcı karar verir. "Kurdum, her şey açık" olan bir güvenlik bileşeni güvenlik bileşeni değildir. Liste her istekte yeniden okunur — yanlış giden bir şeyi durdurmak bir dosyayı düzenlemek kadar kolay olmalı.
  - **Paneli kendi container'ını yeniden yaratabileceği bir eylem YOK:** böyle bir kaldıraç izin listesini etkisiz kılardı.
  - İki bağımsız kapı var ve ikisi de gerekli: panel tarafında RBAC izni (`host.power` / `host.service`), host tarafında izin listesi. Panel ele geçirilse bile ikincisi durur.
  - **Protokol sunucuda doğrulandı (kurulum gerekmeden).** `handle_request()` doğrudan çağrılarak sınandı: bozuk imza, ±30 sn dışındaki zaman damgası, tekrar edilen istek kimliği, izin listesinde olmayan eylem, bilinmeyen eylem, argüman deseni tutmayan birim, `docker.service; rm -rf /` biçiminde kabuk enjeksiyonu denemesi ve aralık dışı argüman — **hepsi reddedildi**; izinli istek çalıştı.
  - **⚠️ Sessiz kalabilecek en büyük risk kanonik JSON'du:** panel TypeScript, helper Python. İkisi aynı baytları imzalamazsa her istek "imza geçersiz" alır ve bu, izin sorunu gibi görünüp saatlerce aranırdı. TypeScript tarafında üretilen bir imza Python tarafında doğrulanarak uyum kanıtlandı.
  - **Yaşanmış hata:** Python `bytes` literali ASCII dışı karakter alamıyor; bir hata mesajındaki Türkçe karakter yüzünden dosya hiç derlenmiyordu. Host'ta `py_compile` ile yakalandı.
- **M1.14** ✅ **Faz 1 uçtan uca doğrulama.** host-helper sunucuya kuruldu ve tur koşuldu.
  - Oturumsuz istekler: sayfalar `307 /login?next=…`, API'ler `401`.
  - 11 job çalışıyor, **0 başarısız**. Şema v8. Metrik katmanları dolu (ham 322 bin satır, 1dk 45 bin, 1sa 821, 1gün 71).
  - 7 monitör `up`, 7/7 container çalışıyor, 9 image / 8 volume / 7 ağ listeleniyor; kullanılmayan 2 image + 4 volume + 1 ağ raporlanıyor.
  - **host-helper (izinli):** `service.list` 173 birim döndü (56 aktif, 1 başarısız: `usbip-attach.service` — panelden önce de bozuktu), `service.status docker.service` → active/running.
  - **host-helper (izinsiz):** `power.shutdown`, `service.restart`, `compose.down` → *"eylem izinli değil"*; `/etc` dizininde compose → *"argüman izin verilen desene uymuyor"*. **Reddi panel değil host verdi.**
  - **compose:** `compose.ps` ve `compose.config` gerçek yığınlarda çalıştı.
  - **⚠️ Turda bulunan gerçek kusur (düzeltildi):** bildirilemeyen bir arızanın **düzelmesi günlüğe düşmüyordu**. İki ayrı defter var — en son ne *bildirildi* ve en son ne *günlüğe düştü* — ama tur atlama kararı yalnızca ilkine bakıyordu. Kanal tanımlı değilken bir servis düşerse olay "kritik" yazılır, hiçbir şey bildirilemediği için `last_notified_severity` "ok" kalır; servis geri geldiğinde `"ok" !== "ok"` yanlış çıkar ve tur atlanır. Sunucudaki gerçek veride yakalandı: Home Assistant 01:16'da düştü, 01:16:30'da döndü, günlükte yalnızca kritik satır vardı. Düzeltildikten sonra aynı durum yeniden kurularak kurtarma satırının yazıldığı doğrulandı.
  - **✅ KAPI KAPANDI.** Telegram ve Home Assistant kanalları canlı kurulumda yapılandırıldı; deneme bildirimi ikisinde de gitti. Zincirin tamamı gerçek bir arızayla sınandı: hiçbir şeyin dinlemediği bir porta bakan geçici monitör düştü → olay günlüğe yazıldı → bildirim **`telegram,ha`** olarak iki kanala birden gönderildi, bastırma yok. Test monitörü, olayı ve alarm durumu sonrasında silindi.
  - **Yaşanmış iki yapılandırma hatası (ikisi de kodda kalıcı olarak çözüldü):** (a) HA sunucu adresine şema yazılmamıştı (`192.168.61.114:8123`) ve `fetch` "Failed to parse URL" diyordu — mesaj sorunun adreste olduğunu söylemiyordu; panel artık eksik şemayı kendisi tamamlıyor (yerel ağ adresleri için `http://`). (b) Telegram `chat_id` alanına botun kullanıcı adı yazılmıştı; Telegram'ın istediği alıcının sayısal kimliği — yardım metni bunu ve nasıl bulunacağını artık açıkça yazıyor.
  - **Kabul edilen sınırlar (kapatılamaz, kayda geçer):** M1.4'ün sıcaklık/S.M.A.R.T/RAID yolları sunucu **Hyper-V sanal makinesi** olduğu için canlı doğrulanamıyor — kod fiziksel donanım için yazıldı, yalnızca fixture'larla sınandı. `docker.sock` pratikte host'ta root demek; `docker-socket-proxy` değerlendirmesi bilinçli teknik borç olarak Faz 3'e bırakıldı.
  - **Kullanıcı tercihiyle kapalı bırakılanlar:** `power.shutdown`, `compose.down`, `service.restart` izin listesinde açılmadı; yedek klasörü takibi (`backup.watch_dir`) boş.

> **Not:** Alarm gruplama/susturma bilinçli olarak bildirim motoruyla (M1.3) *aynı* milestone'da. Sonradan eklenirse her reboot'ta onlarca bildirim yeme dönemi yaşanır.

### FAZ 2 — App Launcher + Ana Sayfa ✅ TAMAMLANDI
- **M2.1** ✅ **Veri modeli + Uygulamalar ekranı.** Migration 009 Faz 2'nin tamamını taşıyan beş tabloyu birlikte açar (`apps`, `app_categories`, `bookmarks`, `wol_devices`, `speedtest_results`): SQLite'ta ALTER TABLE ile yabancı anahtar eklenemediği için bunlar sonradan tek tek açılamazdı. Kart **iki adres** tutar — kullanıcıya gösterilen ve panelin kendi isteklerinde kullandığı; kart `ha.evim.net` gösterirken durum kontrolü ve widget'lar doğrudan yerel IP'ye konuşabilsin diye (reverse proxy'ye bağımlı olmamalı). Yeni yetki: `apps.manage` — kartları **görmek** `panel.view` ile gelir, yönetmek ayrı.
- **M2.2** ✅ **Kart CRUD + logo.** Ekle/düzenle/sil modal; logo yükleme, uzak adres ve favicon fallback (o da yoksa addan türetilen renkte baş harfler). Yüklemede `Content-Type` başlığına **güvenilmez**, dosyanın ilk baytlarına bakılır; dosya adı tamamen panelde üretilir (dizin gezme ve çakışma doğmaz). SVG script taşıyabildiği için logo servisi `sandbox` CSP + `nosniff` ile döner ve oturum ister. Adres alanında **eksik şema kendiliğinden tamamlanır** — bildirim kanallarında yaşanan hatanın aynı kökü.
- **M2.3** ✅ **Kart canlı durum noktası.** Kart kendi kontrolünü yapmaz, M1.2'nin zaten çalışan monitör turundan okur: aralık, zaman aşımı, flap koruması ve bakım penceresi tek yerde kalır. Kapalı monitörün son durumu `bilinmiyor` gösterilir; monitör silinirse kart yaşar, yalnızca noktası söner (`ON DELETE SET NULL`).
- **M2.4** ✅ **Kategoriler + gruplu görünüm + sıralama.** Kategori CRUD (seçilmiş ikon listesi), kategorisiz kartlar "Diğer" başlığında, kategori silinince kartlar silinmez oraya düşer. Sıralama kipi: kategoriler ↑↓, kartlar ←→. Sıralama iki komşunun `sort_order` değerini takas etmez, **tüm listeyi yeniden numaralar** — eşit değerler varken takas hiçbir şeyi değiştirmez ve düğme bozuk görünürdü.
- **M2.5** ✅ **Docker label ile otomatik kart keşfi.** **Opt-in:** yalnızca `panel.enable=true` etiketi taşıyan container kart olur — "port yayınlayan her container kart olsun" ilk turda onlarca çöp kart üretirdi. Etiketler: `.name .url .port .scheme .path .description .category .icon .internal_url`; önek `apps.label_prefix` ile değişir. Adres sırası: açık `url` > açık `port` > container'ın yayınladığı ilk TCP portu (UDP atlanır — 53/udp kart adresi olamaz). **Sahiplik kuralı tek cümle:** elle düzenlediysen senindir — keşfedilen kart `source='docker'`, panelden düzenlenince `manual` olur ve keşif bir daha dokunmaz. Etiket kalkınca/container yok olunca yalnızca `docker` kartları silinir. Kart panelden silinirse tarama geri getirir; kalıcı kaldırmanın yolu etiketi silmektir (formda yazıyor). Zamanlanmış iş (`apps.discover`) + ekrandan "Şimdi tara".
  - **`{host}` yer tutucusu:** keşfedilen adres `http://{host}:8081` olarak saklanır ve isteği karşılayan sunucuda `Host` başlığından çözülür. Panel container'ı kullanıcının paneli hangi adresle açtığını bilemez — aynı sunucuya evden yerel IP, dışarıdan alan adı, tailnet'ten `100.x` ile erişilebilir; adresi keşif anında sabitlemek kartların tek yoldan çalışması demekti. `apps.server_host` ayarı sabit adres isteyene kapıyı açık bırakır. Ham `url` saklanır, çözülmüş adres ayrı alan olarak döner: çözülmüşü kaydetmek yer tutucuyu ilk düzenlemede sessizce yok ederdi.
- **M2.6** ✅ **Servis widget'ları (mimari + Pi-hole).** Widget'lar veriyi **panelin kendi biçimine** çevirip döndürür (istatistik + satır + aksiyon), servisin ham JSON'unu değil — kart ızgarasında Pi-hole, Jellyfin ve qBittorrent yan yana duracak ve hepsinin aynı görünmesi gerekiyor. Yeni servis eklemek = bir dosya yazıp diziye eklemek; form, API ucu, önbellek ve hata gösterimi ortak. **Pi-hole v6:** engellenen sorgu %, en çok engellenen alan adı, engel listesi boyutu, **"5 dk devre dışı bırak"** ve "engellemeyi aç". ⚠️ Pi-hole eşzamanlı oturum sayısını sınırlıyor — panel her yenilemede giriş yapsaydı birkaç dakikada havuzu tüketir ve kullanıcı kendi arayüzüne giremezdi; SID bellekte tutulup yeniden kullanılıyor, 401'de bir kez yenileniyor. Sunucu tarafı önbellek (`apps.widget_ttl`) zorunlu; servise ulaşılamayınca eldeki veri **yaşıyla birlikte** gösteriliyor. Yapılandırma T3 ile **blok halinde** şifreli (alan alan değil: hangi alanın gizli olduğu sağlayıcıya ait ve değişebilir). Çözülemezse kart yaşar, yalnızca widget hata der.
- **M2.7** ✅ **Ana sayfa + ev halkı görünümü + kiosk.** Ana sayfa: arama (kart ve bookmark'ları **birlikte** süzer — kullanıcı aradığı şeyin hangi tür olduğunu düşünmüyor; Enter ilk sonucu açar), kart ızgarası, bookmark grupları, saat, hava durumu (**Open-Meteo** — API anahtarı istemiyor) ve **"internet çalışıyor mu?"** göstergesi. Gösterge üç ayrı şey söylüyor çünkü üçü farklı cevap gerektiriyor: internet yok (modem) / internet var ama servis çökük (sunucu) / her şey çalışıyor (senin cihazın). **Ev halkı görünümü** rol adına değil **yetkiye** bağlı (`panel.dashboard`) — rol adına bakılsaydı M3.1'de özel rol tanımlayan kullanıcı bu davranışı değiştiremezdi. **Kiosk:** oturumsuz, salt-okunur, token'lı URL (`/kiosk/<token>`); duvardaki tablet aylarca açık kalır ve oturum süresi dolardı. Token adreste yolculuk ettiği için verdiği yetki bilerek en dar hali; düz değer bir kez döner, veritabanında sha256 özeti durur.
- **M2.8** ✅ **Yayınlama (Caddy) + sertifika takibi + DDNS.** Panel **ana Caddyfile'a dokunmuyor**: ayrı bir dosya üretiyor, Caddyfile onu `import` ediyor — panelin yazdığı hatalı bir satır ana dosyada olsaydı panel kendi girişini de bozabilirdi; ayrı dosyada en kötü ihtimalle reload reddedilir ve eski yapılandırma çalışmaya devam eder. Caddy **yeniden başlatılmıyor**, `reload` ediliyor: restart açık bağlantıların hepsini düşürür ve panel de Caddy'nin arkasında — kullanıcı her değişiklikte kendi oturumunu keserdi. Bunun için Caddy admin API'si **container içi loopback'te** açıldı (2019 yayınlanmıyor). **Sertifika bitişi** Caddy'nin depolamasından değil, adrese TLS ile bağlanıp sunulan sertifikadan okunuyor — kimin ürettiğinden bağımsız çalışır ve tarayıcının göreceğiyle birebir aynıdır; doğrulama kapalı çünkü ölçülen şey geçerlilik değil bitiş tarihi. **DDNS** (Cloudflare + DuckDNS): IP değişmediyse sağlayıcıya istek gitmez; Cloudflare kayıt id'si saklanmaz her turda aranır (kullanıcı kaydı silip yeniden oluşturursa id değişir ve saklanan değer sessizce ölürdü); DuckDNS HTTP 200 ile `KO` dönebildiği için gövde denetleniyor. Tek seferlik olaylar (sertifika, IP değişimi) alarm motoruna değil `announce()`a gidiyor — motor "koşul sürüyor mu" defteri tutuyor, bunlar ise bir kez olan şeyler.
  - **Yaşanmış kusur:** boş bir named volume ilk bağlandığında sahipliğini imajdaki dizinden devralır. `/app/proxy` yalnızca compose'da tanımlanınca volume root'a ait oldu, panel (uid 1001) yazamadı ve yayınlama ucu boş gövdeyle 500 döndü. Dizin artık imajda oluşturuluyor; ayrıca yazma hatası istisna olarak değil **açıklayıcı mesaj** olarak dönüyor ("kayıt duruyor ama yayında değil").
- **M2.9** ✅ **Ağ keşfi + cihaz envanteri.** Panel container'ı LAN'da değil Docker köprüsünde; ham ARP paketi gönderemez ve `arp-scan` imajda yok. İki adımlı yol: alt ağdaki adreslere **TCP bağlantı denemesi** (paketler host üzerinden LAN'a çıkar ve host'un ARP tablosunu doldurur), sonra host'un ARP tablosu okunur. ICMP kullanılmıyor — ham soket root ister. Sonuç `arp-scan` kadar eksiksiz değil ama ek yetki/paket/bağımlılık istemiyor. **MAC→üretici** IEEE OUI listesinden (`data/oui.csv`, ayda bir tazelenir; imaja gömülmedi çünkü ~2 MB her güncellemede taşınırdı). Cihaz kimliği **MAC** — IP DHCP ile değişir. Görülmeyenler çevrimdışı işaretlenir ama silinmez. **Yeni bilinmeyen cihaz → bildirim**, ama ilk turda değil: envanter boşken her cihaz "yeni" görünür ve bildirim yağmuru olurdu. Otomatik tarama **varsayılan kapalı**.
  - **Yaşanmış kusur:** `/proc/net/*` ağ namespace'ine tabi (`/proc/net` → `/proc/self/net`). Host'un /proc'u mount edilmiş olsa bile container'ın tablosunu döndürüyordu; alt ağ 172.28.0.0/16 (Docker köprüsü) sanıldı ve 65 bin adres taranmaya kalkıldı. Host görünümü **PID 1**'in girdisinden okunuyor (M1.1'in izlediği yolun aynısı) ve /22 üstü ağlar reddediliyor.
- **M2.10** ✅ **Tailscale.** Veri **tailscaled'in yerel API'sinden** okunuyor: soket üzerinden, kimlik gerektirmeden. `api.tailscale.com` daha fazlasını verirdi ama API anahtarı ister — anahtar gerektirmeyen bir kaynak varken onu zorunlu kılmak yanlış olurdu (tag yönetimi ve tailnet geneli cihaz listesi Faz 3'e kaldı). Soket **salt-okunur** mount, modül yalnızca GET yapıyor; tailnet'e katılma/ayrılma bilerek dışarıda (T4). Peer listesi: ad, OS, 100.x IP, çevrimiçi/son görülme, **çıkış düğümü** ve **ağ yönlendirici** rozetleri, MagicDNS adı. `CurAddr` boşsa trafik **DERP rölesi** üzerinden gidiyor demek ve gecikme belirgin artıyor — "bağlı ama yavaş" ayrı işaretleniyor. **Düğüm anahtarı bitişi** sertifikayla aynı mantıkta izleniyor: süresi dolan cihaz tailnet'ten sessizce düşer.
  Veri iki kaynaktan gelir: yerel `tailscaled` soketi (`tailscale status --json` — hızlı, kimlik gerektirmez) ve **Tailscale API** (tailnet geneli cihazlar, key expiry, tag'ler — API anahtarı 🔒).
- **M2.11** ✅ **Wake-on-LAN.** Sihirli paket elle kuruluyor (6 bayt 0xFF + MAC×16); bunun için paket eklemeye değmez. ⚠️ Docker köprüsünden çıkan **yayın paketi LAN'a ulaşmaz** — köprü ayrı bir yayın alanı; bu yüzden kullanıcıya yönlendirilmiş yayın adresi (ör. `192.168.61.255`) soruluyor ve ekranda açıkça yazıyor. **"Gönderildi" ile "uyandı" farklı iddialar:** kontrol adresi verilmemişse panel ikincisini hiç iddia etmiyor. Kayıt, envanterdeki cihazdan tek tıkla açılıyor. **M2.12** ✅ **Speedtest geçmişi.** `speedtest-cli`/Ookla kurulmadı (onlarca MB, Python bağımlılığı, lisans kabulü); Cloudflare'in anahtarsız ölçüm uçları kullanılıyor. İndirmede gövde **sonuna kadar** okunuyor — yoksa yalnızca başlıkların gelme süresi ölçülür ve sonuç saçma çıkar. Gecikme için ortalama değil **en düşük** örnek. Varsayılan kapalı: her ölçüm onlarca MB trafik. **M2.13** ✅ **Yapılandırma export/import.** Kapsam kasıtlı dar — panelin *nasıl kurulduğu* taşınıyor, *ne ürettiği* değil (metrik/uptime/olay/audit dışarıda). **Secret'lar dışarıda:** MASTER_KEY'e bağlılar ve o anahtar yedeğe girmiyor (T3), şifreli blob hedefte çözülemezdi — dosya bu yüzden düz metin paylaşılabiliyor. İçe aktarım **birleştirir, silmez**; eşleşme id ile değil **adla** (kaynaktaki id'ler hedefte başka kayda ait olabilir) ve tamamı tek işlemde.
- **M2.14** ✅ **Faz 2 uçtan uca doğrulama — KAPI KAPANDI.** Sunucuda tur koşuldu: şema **v12**, bütünlük ok. 14 ekranın tamamı 200 (ana sayfa, uygulamalar, ağ, yayınlama, servis durumu, docker, olaylar, işler ve 6 yeni ayar kategorisi). Faz 2 API uçlarının tamamı 200. **18 iş, 0 başarısız.** Ağ taraması gerçek LAN'da (`192.168.60.0/22`) **13 cihaz** buldu, 10'unun üreticisi çözüldü (TP-Link yönlendirici, Espressif, Google, Xiaomi, ASUS); çözülmeyenler rastgeleleştirilmiş MAC taşıyan cihazlar — doğru davranış. Tailscale gerçek tailnet'te okundu: self + 2 peer, ağ yönlendirici rotası `192.168.60.0/22`, anahtar bitiş tarihleri. Yayınlama: kayıt → Caddy yapılandırması üretimi → `reload` başarılı → panel erişimi kesintisiz; silme sonrası yapılandırma temiz. Sertifika kontrolü çalıştı ve çözümlenemeyen alan adını sebebiyle raporladı. Yapılandırma dışa aktarımı **hiçbir gizli değer sızdırmadı**, kendi çıktısı geri yüklendi, bozuk biçim reddedildi. Gerçek hız testi: **664 Mbit indirme / 227 Mbit yükleme / 27 ms**.
  - **Kabul edilen sınırlar:** Let's Encrypt yolu canlı sınanamadı (gerçek alan adı + dışarıdan 80/443 erişimi gerekiyor) — `internal` CA yoluyla ve üretilen yapılandırmayla doğrulandı. DDNS sağlayıcı çağrıları token gerektirdiği için yalnızca hata yolları sınandı. Pi-hole widget'ının başarılı veri yolu, Pi-hole parolası panele girilene kadar açık kaldı; kimlik reddi yolu gerçek Pi-hole v6'ya karşı doğrulandı.

### FAZ 3 — Gelişmiş Yönetim & Otomasyon
- **M3.1** ✅ **Kullanıcı & rol yönetimi UI** + 2FA + **audit log görüntüleyici** (M0.4 çekirdeğinin üstüne). `/users` üç sekme (kullanıcılar · roller · açık oturumlar), `/audit` filtre + CSV, `/hesap` kendi 2FA'n ve parolan. TOTP kendi kodumuzda (RFC 6238 resmî test vektörleriyle doğrulandı), sır T3 ile şifreli, kurtarma kodlarının yalnızca sha256 özeti saklanıyor. **Giriş iki adımlı:** 2FA açıkken parola doğru olsa bile oturum kurulmaz — 5 dk ömürlü, 5 denemelik, tek kullanımlık bilet verilir. **Kilitlenme koruması:** son admin silinemez/pasifleştirilemez/rolü düşürülemez, admin rolünden `users.manage` alınamaz; rol izni değişince o rolü taşıyan oturumlar düşer. Migration 013 Faz 3'ün tüm izinlerini bir kerede tanımlar.
  - **Sunucuda bulunan iki kusur:** (1) `/api/auth/2fa` middleware'in oturum kapısına takılıyordu — ikinci adım tanım gereği oturum kurulmadan çağrıldığı için **2FA açık olan kullanıcı hiç giriş yapamazdı**; (2) `listPermissions` ham `node:sqlite` satırı döndürüyordu, null prototipli nesne sunucu bileşeninden istemciye geçemediği için `/users` 500 veriyordu.
- **M3.2** ✅ **Olay/bildirim merkezi** (uygulama içi, `events` geçmişi + filtre) **+ Değişiklik zaman çizelgesi:** `audit_log` (kim neyi değiştirdi), `events` (ne oldu) ve metrik sıçramaları **tek bir zaman şeridinde** birleştirilir — "22:00'de şu ayar değişti → 22:05'te şu container çöktü" bağlantısı görünür olur. Yeni tablo gerekmez, mevcut üç kaynağın birleşik sorgusudur; olaydan tıklayıp ±30 dk penceresine zoom. `/events` iki sekme oldu: **Olaylar** (alarm listesi, kabul, kanal durumu) ve **Zaman Çizelgesi**. Sıçrama tespiti mutlak seviyeye değil **değişime** bakıyor (1 dk kovalar arası `LAG` farkı) — sabit yüksek disk zaten alarm konusu, çizelgede aranan "tam o anda ne oldu". Yalnızca artışlar kaydediliyor; düşüş olayın bitişi, ayrı satır olsaydı her sıçrama iki kez görünürdü. Audit satırları `audit.view` yetkisi olmayana gösterilmiyor. Eşikler ayarlardan (yüzdelik metrikler ve ağ trafiği ayrı). Sunucuda: 24 saatte 237 kayıt (195 değişiklik · 2 olay · 40 sıçrama), gerçek CPU sıçraması `%3 → %49` yakalandı.
- **M3.3** ✅ **Merkezi log arama:** container logları + journald toplayıcı → SQLite **FTS5**, saklama/budama politikası, arama+filtre UI (kaynak/seviye/zaman), **pattern kuralı → alarm**. (Faz 1'deki canlı SSE log günlük ihtiyacı zaten karşılıyor; burada geçmişe dönük arama eklenir.) Migration 014: `log_lines` + **FTS5 external-content** indeks + tetikleyiciler. External content seçildi çünkü zaman/kaynak filtreleri gerçek B-tree indeks ister, budama `ts` aralığıyla siler ve metin iki kez saklanmaz. Tokenizer `remove_diacritics 2` — "olcum" yazınca "ölçüm" bulunuyor. Toplayıcı **periyodik çekme**, akış değil: kalıcı bağlantı panel yeniden başlayınca aradaki satırları sessizce kaybederdi. İmleç kaynak bazında ve geri gitmiyor; panelin kendi container'ı toplanmıyor (kendi kuyruğunu yerdi). Budama iki eşikten geçiyor — yaş **ve** toplam satır tavanı, sonra FTS `optimize`. journald `host-helper`'ın yeni `journal.read` eylemiyle (salt okuma); izin listesinde yoksa sessizce atlanıyor, hata vermiyor.
  - **Sunucuda doğrulandı:** 6 gerçek container'dan **3701 satır** toplandı; ikinci turda 0 yeni satır (imleç çalışıyor). Sözdizimi bozan sorgular (`"`, `(((`, `NOT`, `AND`) arama motorunu düşürmedi — kullanıcı metni tırnaklanıp AND'leniyor. Seviye/kaynak/zaman filtreleri, sayfalama, metin dışa aktarımı çalıştı. **Desen → olay yolu uçtan uca sınandı:** geçici bir container'a yazılan işaret satırı toplandı, indekslendi, kural eşleşti, olay üretildi ve bekleme süresi ikinci tetiklemeyi engelledi.
- **M3.4** ✅ **Yedekleme motoru:** restic tabanlı — zamanlanmış job, dizin/Docker volume seçimi, **retention politikası**, off-site hedef (S3/rclone), **tek tık geri yükleme**, snapshot listeleme, panelin kendi SQLite yedeği (`VACUUM INTO`). Sıklık, saklanacak yedek sayısı, quiesce, doğrulama ve disk eşiği `backup.*` ayarlarından gelir; **container/volume bazında ezilebilir** ("genelde gecelik, bu container haftalık"). Faz 1'deki backup *takibi* bu motorun çıktısını izler. (M3.14/M3.15 kapsam dışına alındığı için repo bundle'ları ve Vaultwarden veri dizini artık kapsamda değil — kullanıcı Vaultwarden'ı app store'dan kurarsa dizinini yedekleme işine elle ekleyebilir.) **`.env` ve `MASTER_KEY` bilinçli olarak hariç tutulur** (T3 — aksi halde şifreleme anlamsızlaşır); SQLite kullanan container'lar (Vaultwarden dahil) için `quiesce` veya `sqlite3 .backup` ile tutarlı kopya alınır, canlı dosya kopyalanmaz.
  - **Uygulama kararı — restic host'a KURULMUYOR:** her komut `restic/restic` imajından üretilen tek seferlik bir container içinde çalışıyor. Sürüm imajla sabit, `host-helper` izin listesine yeni satır gerekmiyor (panel yalnızca zaten sahip olduğu `docker.sock`'u kullanıyor) ve kaynak dizin/volume container'a **salt-okunur** bağlanıyor. Kabul edilen ödün: depo parolası container'a env ile geçiyor ve `docker inspect` ile görülebilir — `docker.sock`'a erişen zaten host'ta root olduğu için yeni bir açık değil, ama bilinerek seçildi.
  - Migration 015. `quiesce` container'ı yedek süresince durduruyor ve **iş başarısız olsa bile geri başlatıyor** — yedek alınamadı diye Home Assistant'ı kapalı bırakmak, çözmeye çalıştığı sorundan büyük olurdu. restic çıkış kodu 3 (bazı dosyalar okunamadı) kısmi başarı sayılıyor. Retention iş başına etiketle çalışıyor, başka işlerin snapshot'ına dokunmuyor. Geri yükleme yalnızca boş bir hedefe; `/`, `/etc`, `/usr` gibi sistem dizinleri reddediliyor ve kaynağın üzerine hiçbir zaman yazılmıyor. M1.10 yedek takibi artık **iki kaynağa** birden bakıyor: izlenen klasör ve motorun son başarılı çalışması.
  - **Sunucuda uçtan uca doğrulandı:** gerçek restic 0.19.1 ile depo oluşturuldu, host dizini yedeklendi (3 dosya / 197 KB), ikinci tur **0 bayt** ekledi (artımlı çalışıyor), snapshot içeriği listelendi, geri yükleme yapıldı ve **200 KB'lık rastgele dosya bayt bayt aynı** çıktı (`cmp`). Panel veritabanı yedeği: `VACUUM INTO` ile 51 MB tutarlı kopya alındı, canlı `panel.db` yedeğin dışında kaldı. Geçici container'ların hiçbiri geride kalmadı.
  - **Yan bulgu (düzeltildi):** migration öncesi kopyalar hiç budanmıyordu — 14 migration sonra `data/backups` **299 MB**'a çıkmıştı, panelin tüm verisinin (368 MB) çoğu. Artık en yeni 3 tanesi saklanıyor; üç sürüm öncesine dönmek zaten şema uyuşmazlığı yüzünden çalışmıyor. Boyut `/api/health` içinde `backupBytes` olarak görünür oldu.
- **M3.5** ✅ **Web dosya yöneticisi** (gözat/upload/download/düzenle/izin + disk kullanım analizi) **+ disk temizlik asistanı:** Docker overlay2, apt/npm cache, journald, eski log ve yedekler taranır; "şu kadar yer kazanabilirsin" dökümü + kalem bazında tek tık temizlik (her biri onaylı ve audit'li).
  - **Yetki modeli:** okuma `/host/root` salt-okunur bağından doğrudan; **yazma panelin kendisinde değil**, yalnızca hedef klasörü yazılabilir bağlayan tek seferlik bir container'da (M3.4 deseni). Kabuk kullanılmıyor — komutlar dizi olarak veriliyor, dosya adındaki `$(id)`, `; rm -rf`, `--help`, `-rf` yalnızca tuhaf dosya adlarıdır (sunucuda sınandı, hiçbiri çalışmadı). Yol güvenliği tek giriş noktasında: normalize → `NEVER` listesi (`/proc`, `/sys`, `/dev`, `/run`) → izinli kök kontrolü; bu sıra zorunlu, tersi `/home/../etc/shadow`'u geçirirdi.
  - **Sunucuda bulunan iki kusur:** (1) panel `uid 1001` olarak çalıştığı için host kökünü okurken normal Unix izinlerine takılıyordu — `/etc` okunuyor ama `/home/coraspirin` (750) görünmüyordu; yazma root container'dan geçtiği için çalışıyordu, ortaya **"yazabiliyor ama okuyamıyor"** gibi tuhaf bir durum çıkmıştı. Artık okuma da, YALNIZCA izin hatası aldığında, root container'a düşüyor (dünyaya açık yollar 22 ms, yükseltilmiş yol ~540 ms). Yetki artışı yok: `docker.sock` zaten host'ta root demek. (2) Docker, bind kaynağı yoksa onu **sessizce root'a ait boş klasör olarak yaratıyordu** — yoldaki bir yazım hatası hata mesajı yerine çöp dizin üretiyordu; artık klasörün varlığı önceden soruluyor.
  - **Hassas dosya listesi:** okuma yükseltilmiş yetkiyle çalıştığı için `/etc` varsayılan köklerden çıkarıldı; ayrıca `shadow`, `gshadow`, `sudoers`, SSH host anahtarları, `id_rsa`, `.env`, `.git-credentials` **listelenir ama içeriği okunamaz/indirilemez** (kök listesine `/etc` eklense bile — sunucuda doğrulandı).
  - **Temizlik asistanı kalem kalem, toplu düğme bilerek yok:** sarkan image silmek zararsız, kullanılmayan volume silmek veri kaybıdır; aynı düğmenin altına konamazlar. journald yalnızca **raporlanıyor**, silinmiyor (doğru yol `journalctl --vacuum-size`). Sunucuda gerçek tarama: **4,88 GB** geri kazanılabilir (3,44 GB sarkan image, 836 MB apt önbelleği, 407 MB kullanılmayan image, 176 MB migration yedeği, 24 MB döndürülmüş log).
- **M3.6** ✅ **Veritabanı yöneticisi (Adminer tarzı):** sunucudaki veritabanlarına bağlan, içeriği gözat, sorgu çalıştır.
  - **Bağlantılar:** Docker container'larından otomatik keşif (image adından motor tanınır, bağlantı bilgileri container env'inden önerilir) + elle bağlantı ekleme. Parolalar T3 ile şifreli. Bağlantı testi.
  - **Gözat:** veritabanı → şema → tablo ağacı; tablo listesi (satır sayısı, boyut); **sayfalanmış veri grid'i** (sıralama, sütun filtresi, satır detayı); **Yapı** sekmesi (sütun tipleri, index'ler, foreign key'ler); ilişkili satıra gitme.
  - **Sorgu:** SQL editörü (söz dizimi vurgulama, `Ctrl+Enter` çalıştır), sonuç grid'i + süre + etkilenen satır, **sorgu geçmişi** (kullanıcı bazlı) ve **kayıtlı sorgular**, sonucu **CSV/JSON export**.
  - **Düzenleme:** satır ekle/düzenle/sil (grid içinde), yalnızca `db.write` izniyle.
  - **Motorlar:** PostgreSQL, MySQL/MariaDB, SQLite (container'ların dosyaları), Redis (key gözatıcı — SQL değil, ayrı basit görünüm).
  - **Güvenlik/koruma:** `db.read` / `db.write` ayrı izinler; **varsayılan salt-okunur**, yazma bağlantı bazında açılır; **sorgu zaman aşımı ve satır limiti** (kazara `SELECT *` panelin belleğini yemesin); yazma ve şema değiştiren her sorgu **audit'e**; tehlikeli ifadeler (`DROP`/`TRUNCATE`/`DELETE` WHERE'siz) ek onay ister.
  - **Uygulama:** migration 016. Yazma için **iki ayrı kapı**: `db.write` izni *ve* bağlantının "yazılabilir" bayrağı — izin tek başına yetmiyor, çünkü yanlış pencerede çalıştırılan bir `UPDATE` geri alınamaz. SQL süzgeci yorumları ve dize sabitlerini temizledikten sonra bakıyor: sütun adında geçen "delete" ifadeyi tehlikeli yapmıyor (sunucuda sınandı). Çoklu ifade reddediliyor. **Redis için bağımlılık yok** — RESP protokolü bu kullanım için elli satır. Keşif imaj adından motoru tanıyor, env'den bağlantı bilgisi **öneriyor** ve her zaman salt-okunur başlıyor.
  - **SQLite'ın izin sorunu:** panel dosyayı okuyabiliyorsa (HA'nın 755 veritabanı) doğrudan `node:sqlite`; okuyamıyorsa (Pi-hole'un 640 dosyaları) sorgu panelin **kendi imajından** üretilen root container'da çalışıyor. Dosya **kopyalanmıyor** — Pi-hole FTL 485 MB.
  - **Sunucuda doğrulandı:** dört motor da gerçek veriyle çalıştı. Pi-hole gravity (17 tablo), Home Assistant (13 tablo, `states_meta` okundu), geçici PostgreSQL 16 / MySQL 8 / Redis 7 container'larında CREATE→INSERT→SELECT→yapı turu tamam. Salt-okunur bağlantıda dört yazma denemesi de reddedildi; WHERE'siz UPDATE/DELETE onay istedi.
  - **Sunucuda bulunan iki kusur:** (1) `INSERT/UPDATE/DELETE` hep **"etkilenen: null"** dönüyordu — satır döndüren ifadeyi deneme-yanılma ile ayırmak yanlıştı; `node:sqlite` bir INSERT için `.all()` çağrıldığında hata atmayıp boş dizi döndürüyor ve değişiklik sayısı kayboluyordu. (2) Tablo listesi **tablo başına ayrı `COUNT(*)`** açıyordu; dosya okunamadığında bu tablo başına ayrı container demekti — Pi-hole'un 17 tablosu **8,9 saniye** sürüyordu. Tek `UNION ALL`'a indirildi, yapı bilgisi de `pragma_*` tablo-değerli fonksiyonlarıyla tek sorguya toplandı: **1,6 sn** (HA 6,9 → 1,2 sn).
- **M3.7** ✅ **Firewall (ufw) + açık port/dinleyen servis** yönetimi (host-helper). Port taraması `/proc/net/*` dosyalarını doğrudan okuyor (`ss`/`netstat` değil: çıktı biçimi sürümden sürüme değişiyor). **İki ad alanı sorunu:** `/proc/net/*` ağa, `/proc/<pid>/fd` PID'e bağlı — tarama `network=host` + `pid=host` ile açılan tek seferlik container'da yapılıyor; M2.11'deki "container kendi ağını taradı" tuzağının aynısı. Adresler little-endian onaltılıktan çözülüyor.
  - **Port listesi risk damgası vurmuyor:** "0.0.0.0'a bağlı" bir bilgi, "tehlikeli" bir yargı — `0.0.0.0:53` Pi-hole için doğru yapılandırmadır. ufw kural söz dizimi **host tarafında** doğrulanıyor (yalnızca `port/proto` ya da `from <ip> to any port <n>`); serbest metni geçirmek izin listesini anlamsız kılardı. 22/80/443'ü reddeden kural ek onay istiyor.
  - **Sunucuda doğrulandı:** 37 dinleyen soket, 30'u her arayüzde, süreç adları ve container eşlemesi doğru (Pi-hole 53, Mosquitto 1883, HA 8123). Kabuk enjeksiyonu denemelerinin tamamı host tarafında reddedildi.
  - **Kabul edilen sınır:** ufw kuralları için `host-helper` güncellenmeli ve izin listesine satır eklenmeli (root gerektirir). Panel hangisinin eksik olduğunu ayırt edip komutu gösteriyor; sessizce boş liste göstermek "kural yok" yanılgısına yol açardı.
- **M3.8** ✅ **Güvenlik izleme:** fail2ban ban listesi + başarısız login + **Trivy/Grype ile Docker image CVE taraması** (periyodik, kritik bulgu → alarm) + **0.0.0.0'a bind edilmiş riskli port uyarısı** + SSH anahtar denetimi. **+ Port yönlendirme envanteri:** router'a **UPnP/IGD** sorgusuyla açık yönlendirmeler listelenir — özellikle bir uygulamanın senden habersiz açtırdıkları; kayıt bazında "bu ne, hâlâ gerekli mi" notu ve beklenmedik yeni yönlendirmede alarm. **+ Dış görünürlük kontrolü:** panelin gerçekte dışarıdan hangi portlarının göründüğü. *(Not: bu kontrol ağın dışından bir bakış açısı ister; sunucunun kendisi kendi dış yüzünü göremez. Harici bir port-kontrol servisine istek atılır — hangi servis kullanılacağı ve bunun IP'yi üçüncü tarafa bildirdiği ayarlarda açıkça belirtilir, varsayılan **kapalı**.)*
  - **Uygulama:** migration 017. Trivy tek seferlik container'da, açık veritabanı kalıcı volume'de. Yalnızca **düzeltmesi olan** açıklar listeleniyor — kapatılamayan bir CVE için yapılacak bir şey yok ve listeyi doldurup gerçek işi gizliyor. Alarm **yalnızca yeni kritik bulgu** için; her turda aynı CVE'yi bildirmek gürültü üretip gerçekten yeniyi gizlerdi.
  - **fail2ban'da panel BAN EKLEYEMİYOR**, yalnızca okuyor ve ban kaldırabiliyor: ban ekleyebilen bir panel, ele geçirildiğinde "istediğim IP'yi sunucudan kes" düğmesi olurdu. Panelin kendi giriş denemeleri ayrıca gösteriliyor — fail2ban SSH'ı izliyor, web girişi ayrı bir yüzey.
  - SSH denetimi anahtarın kendisini değil **parmak izini** gösteriyor. UPnP için bağımlılık yok (SSDP bir UDP yayını, IGD düz SOAP); sınır ekranda yazılı: elle eklenen yönlendirmeler UPnP listesinde çıkmayabilir, **boş liste "yönlendirme yok" demek değil**.
  - **Sunucuda doğrulandı:** 6 gerçek image tarandı — Pi-hole 2 kritik / 30 yüksek (`bind-libs`), defterim 1 kritik, panelin kendi imajı 1 kritik. SSH denetimi 2 anahtar buldu ve "parola ile SSH girişi açık" uyarısını üretti. Router'da UPnP kapalı çıktı.
  - **Yol boyunca bulunan üç kusur:** (1) geçici container'ın imajı yoksa panel indirmiyordu — CVE taramasının tamamı bu yüzden düşüyordu; artık 404'te bir kez indirilip yeniden deneniyor. (2) Docker log çerçeveleri sökülürken **stdout ve stderr birleştiriliyordu**; Trivy günlüğünü stderr'e, sonucu stdout'a yazdığı için JSON hiç ayrıştırılamıyordu — çerçeve başlığının ilk baytı akış türünü zaten söylüyor, artık ayrı tutuluyor. (3) Log okumadaki `tail=2000` sınırı Trivy'nin uzun JSON'unu kırpıyordu.
  - **Kabul edilen sınır:** Home Assistant imajı (3,42 GB) Trivy tarafından Docker daemon'dan okunamıyor (tar akışı eksik geliyor — Trivy–Docker arasındaki bilinen bir sınır, disk sorunu değil). Panel bunu ham yığın izi yerine anlaşılır biçimde söylüyor ve `--image-src remote` seçeneğini ayara koyuyor (varsayılan kapalı: imajı yeniden indiriyor).
- **M3.9** ✅ **Host cron yönetimi** (UI). `host_cron_jobs` TABLOSU YAPILMADI ve gerekmedi: cron'un kendi dosyaları zaten tek doğru kaynak, panelin ikinci bir kopya tutması ikisinin ayrışmasına davetiye olurdu. host-helper'a da ihtiyaç duymuyor — okuma yükseltilmiş container'dan (`/etc/crontab`, `/etc/cron.d/*`, `/var/spool/cron/crontabs/*`), yazma **yalnızca** `/etc/cron.d/panel-*` dosyalarına.
  - **Panel sistemin cron dosyalarına dokunmuyor:** yanlışlıkla `/etc/crontab`'ı bozmak, sunucunun bakım görevlerini sessizce durdurmak olurdu; onlar salt-okunur listeleniyor. Ayrıştırmada kritik ayrım: `/etc/crontab` ve `/etc/cron.d` zamanlamadan sonra **kullanıcı alanı** taşıyor, kullanıcı crontab'ları taşımıyor — karıştırmak komutun ilk kelimesini yutmak demek. `cron.d` nokta içeren dosya adlarını yok saydığı için ad doğrulaması bunu söylüyor ("kaydettim ama çalışmıyor" olmasın).
  - **Sunucuda doğrulandı:** 13 gerçek görev okundu (sistem, `sysstat`, `e2scrub_all`, kullanıcı crontab'ı ve Faz 1'den `panel-os-updates`). Gerçek dosya yazıldı, kapatıldı (satır yoruma dönüştü, silinmedi), `@daily` kısayolu çalıştı, silindi; `panel-os-updates` yerinde kaldı. Dokuz doğrulama kuralının hepsi mesajıyla birlikte reddetti.
  - **Yol boyunca bulunan iki kusur:** Ubuntu'nun `/etc/crontab`'ındaki örnek satırı (`# * * * * * user-name command to be executed`) biçim olarak geçerli bir göreve benziyor ve listede sahte kayıt olarak çıkıyordu — kapatılmış satırlar artık yalnızca panelin kendi dosyalarında görev sayılıyor. Ayrıca kendi eklediğim `respond()` yardımcısında **yayma sırası** yüzünden `readCron()`'un `error: null` alanı işlem hatasının üzerine yazıyor ve doğrulama hataları boş görünüyordu. Panelin kendi arka plan işleriyle (M0.6 `jobs`) karıştırılmaması için ekranda ayrı başlık: "Host Zamanlanmış Görevler" ↔ "Panel İşleri".
- **M3.10** ✅ **App store:** compose şablon katalogundan tek-tık kurulum. Migration 018 (`app_stacks`) + 021 (`appstore_sources`). **Dahili katalog kodun içinde**; eklenen uzak kaynaklardan yalnızca VERİ okunuyor ve compose YAML'ını panel üretiyor — panel dışarıdan indirdiği bir compose dosyasını `docker compose up` ile çalıştırsaydı, o dosyayı değiştirebilen herkes sunucuda root olurdu (ayrıntı: "Uygulama Katalogu" bölümü). 9 dahili şablon / 8 kategori; her şablonda değişkenler (port/yol/parola), **uyarılar** ve "kurulumdan sonra ne yapmalısın" metni var. Kurulum modalinde **uyarılar değişkenlerden önce** gösteriliyor — "Vaultwarden'ı düz HTTP'de kullanma" bilgisini kurulumdan sonra vermenin faydası olmazdı.
  - **Var olan dosyanın üzerine asla yazılmıyor** (`wx` bayrağı): aynı ada ikinci kez kurulum, çalışan bir yığının `docker-compose.yml`'ini sessizce değiştirmek olurdu. Değişken değerleri compose'a girmeden önce doğrulanıyor (satır sonu enjeksiyonu dahil) — YAML'a kaçan bir `\n` şablonun tamamını yeniden yazabilirdi.
  - **Kaldırma dürüst davranıyor:** `compose.down` Faz 1'de bilerek izin listesine konmadı, `/opt/stacks` da helper'ın compose desenine uymuyor. Panel bu iki durumda ham "argüman izin verilen desene uymuyor" hatası yerine ne olduğunu anlatıyor, **container'ların hâlâ çalışıyor olabileceğini söylüyor** ve elle çalıştırılacak komutu veriyor. Veri dizini hiçbir koşulda silinmiyor.
  - **Sunucuda doğrulandı:** IT-Tools gerçekten kuruldu (`/home/coraspirin/docker/m310test`), container `running` ve 8399 portu **HTTP 200 text/html** döndü; `restart` ve `pull` çalıştı; 8 doğrulama kuralının hepsi mesajıyla reddetti. Test dizini sonradan temizlendi, kullanıcının kendi dizinlerine dokunulmadı.
- **M3.12 / M3.14 / M3.15 — KAPSAM DIŞI (kullanıcı kararı, 2026-07-27).** Home Assistant entity/servis entegrasyonu, Depolar+GitOps ve Şifre Kasası yapılmayacak. HA'ya bildirim gönderme (Faz 1) çalışmaya devam ediyor ve M3.11'in MQTT yayını HA tarafında otomasyon yazmayı mümkün kılıyor; Vaultwarden app store katalogunda şablon olarak duruyor (tek tıkla kurulabilir, panel entegrasyonu yok). **Yan etki:** migration 013'te tanımlanan `vault.view` ve `repos.manage` izinleri hiçbir ekrana bağlı değil — şema v18 sunucuda kurulu olduğu için migration geri alınmıyor, izinler M3.16'da arayüzden gizlenecek.
- **M3.11** ❌ **KALDIRILDI (kullanıcı kararı, 2026-08-03).** Otomasyon kuralları, webhook, API token ve Prometheus `/metrics` bir bütün olarak kaldırıldı (migration 022); ayrıntı ve gerekçe için aşağıdaki "Otomasyon Kaldırıldı" bölümü. **MQTT yayını duruyor** ve HA tarafında otomasyon yazmayı mümkün kılmaya devam ediyor. Kaldırılanın tanımı (kayıt için): otomasyon kuralları (X→Y) + **webhook** + **API token** + **Prometheus `/metrics`** + **MQTT yayını**. Migration 019 (`automations`, `automation_runs`, `api_tokens`). **Alarm motoruyla ayrım net:** M1.3 motoru "bu bir sorun mu, ne kadar süredir sürüyor, tekrar bildirilmeli mi" sorusunu yanıtlıyor ve çıktısı bir `events` satırı; otomasyon o çıktının üstüne binip "ne YAPILSIN" sorusunu yanıtlıyor. Tek motora sokmak bildirim mantığıyla eylem mantığını birbirine düğümlerdi. Tetikleyiciler: panel olayı, gelen webhook, cron. Eylemler: bildirim, container start/stop/restart, dış adrese POST, MQTT yayını, olay kaydı. Metinlerde `{{alan}}` yer tutucuları bağlamdan doldurulur.
  - **Döngü koruması iki kilitli:** `event` eylemi yeni olay yazıyor ve `event` tetikleyicisi olayları dinliyor — hiçbir şey yapılmasa kendini tetikleyen bir kural saniyede binlerce satır üretirdi. (1) Otomasyonun yazdığı olayların kaynağı `automation:` önekini taşıyor ve olay tetikleyicisi bunları görmüyor. (2) Her kuralın bekleme süresi var; flap eden bir container saniyede bir yeniden başlatılamıyor. **Kuru çalıştırma** koşulları değerlendirip eylemleri yalnızca anlatıyor — kuralı canlıda denemeden önce "ne olacaktı" görmenin tek dürüst yolu. **Eşleşmeyen turlar da kaydediliyor:** "kuralım neden çalışmadı" sorusunun cevabı, çalışmayan turların hiç yazılmadığı bir tabloda yoktur.
  - **Olmayan alan koşulu SAĞLAMIYOR** (tanımsız için `ne` bile false döner): doğru saymak, yanlış yazılmış bir alan adını sessizce "her zaman doğru"ya çevirir ve kuralın her olayda tetiklenmesinin en olası sebebi bu olurdu. Webhook'ta **slug ile gizli anahtar ayrı**: slug adresin parçası olduğu için vekil günlüklerine ve `Referer` başlığına düşebilir, anahtar düşmez. Bilinmeyen slug ile yanlış anahtar **aynı** 401'i döner — farklı cevap, var olan slug'ları deneyerek bulmayı mümkün kılardı.
  - **MQTT için bağımlılık EKLENMEDİ:** CONNECT/PUBLISH/DISCONNECT elle yazıldı (M3.6'daki RESP sürücüsüyle aynı gerekçe — `mqtt` paketi abonelik, oturum kalıcılığı, otomatik yeniden bağlanma ve WebSocket taşıması getiriyor, hiçbiri kullanılmayacak kod). Metrikler **saklanarak** (retained) basılıyor: HA yeniden başladığında son değeri hemen alsın. Olaylar **saklanmadan**: saklansaydı yeni bağlanan her istemci geçmiş bir arızayı yeni olmuş gibi görürdü. **HA otomatik keşfi** var — panel HA'ya bir şey sormuyor, kendi verisini HA'nın anlayacağı biçimde ortaya koyuyor; iptal edilen M3.12'nin yerini kısmen dolduruyor ve HA token'ı gerektirmiyor.
  - **Prometheus ucu kök `/metrics`'te** ve oturum çerezi değil API anahtarı istiyor: scrape aracının çerezi yoktur. Kapalıyken 404 (bir uç "burada bir şey var ama giremiyorsun" demesin). Anahtarların yalnızca sha256 özeti saklanıyor, kapsamlar RBAC izinlerinden ayrı. `?token=` de destekleniyor (özel başlık gönderemeyen araçlar için) ve bedeli — anahtarın erişim günlüklerine düşebilmesi — ayar yardımında yazılı. `null` metrik hiç yazılmıyor: örnek toplanmadıysa sıfır yazmak "CPU %0" yalanı olurdu.
  - **Sunucuda doğrulandı — 55 kontrol, 0 başarısız.** Panel API'si: 12 doğrulama kuralının hepsi mesajıyla reddetti; kuru çalıştırma, koşul süzme, şablon doldurma, bekleme süresi, webhook anahtar yenileme ve döngü koruması çalıştı. `/metrics`: 150 satır / 27 metrik, gerçek `panel_cpu_percent 4.8`, 7 container, etiketli disk metrikleri, tekrarlanan HELP satırı yok; iptal edilen ve yanlış kapsamlı anahtarlar reddedildi. **Gerçek Mosquitto'ya karşı:** QoS 1 ile broker PUBACK gönderdi, 96 konu yayınlandı ve `mosquitto_sub` ile broker'dan geri okundu, saklama davranışı iki yönde de doğrulandı. **Uçtan uca:** HA otomatik keşfiyle **Home Assistant'ta 15 gerçek sensör entity'si oluştu** (`sensor.sunucu_paneli_toplam_cpu_kullanimi` vb., hepsi tek cihaz altında), ilanlar geri alınınca **HA'dan tamamen silindi**. Doğrulama sonrası ayarlar varsayılana (kapalı) döndürüldü — kullanıcının HA'sını kalıcı değiştirmek onun kararı.
  - **Yol boyunca bulunan iki kusur:** (1) M3.7'deki quiesce yolu tanımsız bir ayar anahtarı (`docker.stop_timeout_seconds`) okuyordu; `getNumber` tanımsız ayar için hata fırlattığı için **yedek öncesi container durdurma her seferinde patlıyordu** — yedekler quiesce'siz doğrulandığı için şimdiye kadar görünmemişti. (2) `jobs/runner → jobs/definitions → alerts/announce → otomasyon motoru → metrik toplayıcı` şeklinde bir **modül döngüsü** oluşuyordu; ESM döngüyü çökmeden yükler ama sıraya bağlı olarak bir modül henüz tanımlanmamış bir dışa aktarım görebilir. İş sayaçları artık `jobStatuses()` yerine doğrudan tablodan okunuyor.
- ~~**M3.12** Home Assistant entegrasyonu~~ — kapsam dışı (yukarıya bakınız).
- **M3.13** ✅ **Komut paleti (Ctrl+K)** + gösterge paneli widget özelleştirme. Migration 020 (`dashboard_widgets`). **Düzen kullanıcı başına** tutuluyor, global ayar olarak değil: aynı paneli kullanan iki kişinin ilgilendiği şeyler farklı ve birinin düzeni diğerininkini bozmamalı. Tablo yalnızca **sapmaları** tutuyor — kaydı olmayan kullanıcı şemadaki varsayılanı görür, yeni bir widget eklendiğinde kimsenin satırını güncellemek gerekmez, kendiliğinden sonda belirir.
  - **Widget'lar sunucuda render edilip hazır JSX olarak** düzen bileşenine geçiyor. Alternatif — her widget'ı istemci bileşenine çevirip kendi verisini çektirmek — altı yeni API ucu ve altı ayrı yükleme durumu demekti; oysa kullanıcının değiştirdiği tek şey sıra ve görünürlük. Sürükle-bırak için **kütüphane yok**: tarayıcının kendi HTML5 DnD'si tek sütunlu bir liste için yeterli. Dar widget'ların ikili ızgaraya toplanması tamamen sunum katmanında — kullanıcı iki boyutlu bir ızgarayla uğraşmıyor.
  - **Sade görünüm (`panel.dashboard` yetkisi olmayan) düzenlenebilir DEĞİL:** duvara asılı ekranı ya da ev halkının hesabını kişiselleştirme kutularıyla doldurmak, o görünümün varlık sebebine aykırı olurdu. Yetkisi olmayan kullanıcıya bakım ve sistem widget'ları **hiç sunulmuyor** (gizlenmiyor — sunulmuyor).
  - **Palet iki kaynaktan besleniyor:** sayfalar `nav.ts`'ten (ağ isteği yok — palet ilk tuşa basıldığı an kullanılabilir olmalı), canlı kayıtlar `/api/palette`'ten ve **yalnızca ilk açılışta** (her sayfa yüklemesinde container listesi istemek, hiç kullanılmayabilecek bir özellik için Docker'a sürekli soru sormak olurdu). Her kaynak **kendi yetkisine göre** süzülüyor — palet bir kısayol, yetki atlama yolu değil. Eşleşme **diyakritiksiz**: "olcum" yazınca "ölçüm" bulunuyor. Kısayolun yanında görünür bir düğme de var: keşfedilmeyen bir kısayol yok sayılır.
  - **Sunucuda doğrulandı — 17 kontrol, 0 başarısız.** Palet 17 gerçek kayıt döndürdü (7 container, 7 monitör, 3 uygulama kartı); `docker.view`/`metrics.view` izni olmayan geçici bir kullanıcı hesabıyla denendiğinde container ve monitör **hiç görünmedi**. Düzen kaydedildi, geri okundu, yeni istekte de aynı kaldı; gizlenen widget gizli kaldı; dört doğrulama kuralı (boş düzen, bilinmeyen widget, aynı widget iki kez, bilinmeyen işlem) mesajıyla reddetti; ikinci kullanıcının düzeni admin'inkinden **etkilenmedi**; varsayılana dönüş çalıştı. Test kullanıcısı, rolü ve düzen kayıtları sonradan silindi.
- ~~**M3.14** Depolar (Repositories) — GitHub Senkron & GitOps~~ — kapsam dışı.
- ~~**M3.15** Şifre Kasası (Vaultwarden entegrasyonu)~~ — kapsam dışı.
- **M3.16** ✅ **Faz 3 uçtan uca doğrulama — KAPI KAPANDI.** Sunucuda tam tur koşuldu: **57 kontrol, 0 başarısız.** Şema **v20**, WAL, bütünlük ok. **21 ana ekranın ve 18 ayar kategorisinin tamamı 200**; `/settings` ilk kategoriye yönlendiriyor (307 — kendi içeriği yok). GET destekleyen **15 Faz 3 API ucu** 200; `/api/files` yolsuz istekte 400, `?path=/var/log` ile 200; yalnızca yazma için açılan dört uç (`/api/roles`, `/api/logs/patterns`, `/api/backup/repos`, `/api/host`) GET'e **405** döndü — okuma yüzeyi gereksiz genişletilmemiş. **26 arka plan işi kayıtlı, 0 başarısız** (3'ü uzun cron'lu olduğu için henüz hiç çalışmamış: `network.oui`, `security.vuln_scan`, `automation.prune`). Faz 3 verisi gerçekten yerinde: **3803 log satırı** (FTS5 aramada "error" için 502 eşleşme), 419 audit kaydı, 35 CVE tarama kaydı, 4 log deseni, 3 rol / 30 izin.
  - **Güvenlik sınırları sınandı:** 13 hassas ucun tamamı oturumsuz istekte **401**; CSRF başlığı olmayan POST **403**; **172 ayarın 6 secret'ı da API'de düz metin dönmedi**, her ayarın tanımlı bir kategorisi var ve hepsi çözümlenebiliyor.
  - **Kapsam dışı izinler temizlendi:** `vault.view` ve `repos.manage` rol düzenleme ekranında artık sunulmuyor (28 izin kaldı). Satırlar `permissions` tablosundan **silinmedi** — şema sunucuda kurulu ve bir migration'ı geriye dönük değiştirmek, aynı şemayı farklı yollardan üretilmiş iki veritabanı demek olurdu. Rol bir kez düzenlendiğinde eski yetkiler de temizleniyor.
  - **Doğrulamanın kendisinde bulunan kusurlar panelde değil test betiğindeydi** ve bu ayrım kayda geçiyor: ilk turda "başarısız" görünen altı maddenin dördü GET'i olmayan uçlara GET atmaktan, biri `/settings`in yönlendirmesini hata saymaktan, biri de kabuk tırnaklaması yüzünden bozulan bir kategori listesinden kaynaklanıyordu. Hepsi doğrudan sunucuda tek tek doğrulanıp betik düzeltildi — "testim kırmızı yandı, demek ki kod bozuk" varsayımı bu turda yanlış olurdu.
  - **Kabul edilen durum:** yedek deposu/işi, kurulu yığın, otomasyon kuralı ve API anahtarı sayaçları **0** — hepsi kendi milestone'unda gerçek sunucuda çalıştırıldı ve test kayıtları sonradan temizlendi. Panelde kalıcı bir yedekleme işi ya da otomasyon kuralı tanımlamak kullanıcının kararı; kapı bunu beklemiyor.

- **M3.17** **Port Haritası (`/ports`).** "Hangi container ya da sistem servisi hangi portu tutuyor" ve "yeni container'a hangi portu vereyim" sorularının tek ekranı. M3.7'nin port envanteri temel alındı ve dört eksiği kapatıldı: sahip artık `docker-proxy` değil gerçek container/servis adı (T13), `network_mode: host` container'lar da eşleşiyor, sonuç önbelleğe yazılıyor (`security.ports`, saatlik `security.port_scan` işi tazeliyor) ve ekran verinin yaşını yazıyor, boş port bulucu ile çakışma tespiti eklendi.
  - **Ayrım:** `ports.ts` I/O yapar (host ad alanında geçici container), `portmap.ts` saf mantıktır (sahiplik zinciri, rezerve portlar, çakışma). İkincisinin 27 testi var — "hangi port boş" sorusuna yanlış cevap vermek, kullanıcının o portu bir container'a verip Docker'ın reddetmesiyle sonuçlanır.
  - **Docker detay penceresi** yayınlanmış her portun yanına "host'ta gerçekten dinleniyor mu" rozeti koyuyor; veri önbellekten, `security.view` izni yoksa rozet sessizce gösterilmiyor.
  - **Sunucuda doğrulanacak:** caddy 8443/8080'de container adıyla, sshd 22'de `ssh.service` olarak görünmeli.

- **M3.18** **Güvenlik Duvarı ekranı (`/firewall`).** M3.7'de Güvenlik ekranının bir bölümüydü; kendi menüsüne çıktı çünkü eksikleri oraya sığmıyordu. Yeni: ufw açma/kapama, varsayılan gelen/giden politikanın gösterilmesi ve değiştirilmesi, kural açıklamaları, ve serbest metin kutusu yerine yapılandırılmış form.
  - **Serbest metin kutusu kaldırıldı.** Helper yalnızca iki kalıbı kabul ediyor; kullanıcının onları ezberlemesini beklemek "gecersiz ufw kurali" hatasını ekranın olağan cevabı hâline getirmişti. Form yalnızca kabul edilen kalıbı üretebiliyor ve üreteceği kuralı yazıyor.
  - **⚠️ Yaşanmış kusur — çok kelimelik kural hiç çalışmıyormuş:** helper komutu `shell=False` ile liste olarak çalıştırıyor, dolayısıyla `["ufw", "allow", "from 1.2.3.4 to any port 22"]` kuralı TEK argüman olarak geçiriyordu ve ufw bunu ayrıştıramazdı. `port/proto` biçimi tek kelime olduğu için çalışıyor, `from ... to any port ...` biçimi M3.7'den beri çalışmıyordu. `_ufw_rule` artık desene uyduktan SONRA boşluklardan bölüp argv parçaları döndürüyor; `comment` boşluk içerdiği için ayrı argüman.
  - **Yeni helper eylemleri:** `ufw.status_verbose` (varsayılan politika ve log seviyesi — `verbose` ile `numbered` birlikte verilemiyor), `ufw.enable`, `ufw.disable`, `ufw.default`, `ufw.logging`, `ufw.app_list`. Her biri `allow.conf`'ta ayrı satır; `install.sh` şablonuna kapalı olarak eklendi.
  - **Kilitleme koruması** T13'te anlatıldığı gibi; 22 testin yarısı bunu kolluyor.
  - **Denetim kaydı adları DEĞİŞMEDİ** (`firewall.allow` / `firewall.deny` / `firewall.delete`) — uçlar `/api/security`den `/api/firewall`e taşındı ama geçmiş kayıtlar sorgulanabilir kalmalı. Eklenenler: `firewall.enable`, `firewall.disable`, `firewall.default`.
  - **Yeni izin anahtarı AÇILMADI:** `security.view` / `security.manage` kullanılmaya devam ediyor. `firewall.*` öneki migration 026 + `auth/types.ts` + `GROUP_LABELS` gerektirirdi ve bugün `security.manage`'i olan herkes bu işlemleri zaten yapabildiği için yeni bir sınır getirmezdi.
  - **Sunucuda doğrulanacak:** helper güncellenmeden ekranın "helper eski sürümde" demesi; 22 kuralı yokken "Etkinleştir"in 409 dönüp ufw'ye dokunmaması; Docker yayınlı bir porta yazılan deny kuralının gerçekten atlandığının `curl` ile teyidi.

- **M3.19** **Compose servis düzenleyici ve kurulum ön kontrolleri.** İki şikâyetin cevabı: yığın eklerken port/ağ ayarı yapılamıyordu (kullanıcıdan alınan tek şey ad + ham YAML'dı) ve container popup'ında portlar salt okunurdu. Aynı çekirdek iki kapıdan açılıyor — Docker popup'ındaki "Compose ayarları" bölümü ve Compose Yığınları ekranındaki "Ön kontrol" düğmesi.
  - **Ayrım:** `compose/ports.ts` ve `compose/service.ts` saf (73 test), `compose/checks.ts` saf, `compose/locate.ts` ve `compose/edit.ts` I/O. Port söz diziminin üç biçimi de (kısa, uzun, ham) tanınıyor ve **geldiği biçimde** geri yazılıyor.
  - **Bedava kazanç — atılan uyarılar:** `install.ts` `compose config`'in stderr'ini yalnızca çıkış kodu sıfır DEĞİLKEN okuyordu. Oysa compose, tanımsız `${DEĞİŞKEN}` ve kullanımdan kalkmış anahtar uyarılarını **çıkış kodu 0 ile** stderr'e yazar. Yani panel bu uyarıları alıyor ve çöpe atıyordu; `${DB_PASSWORD}` tanımsızsa compose onu boş dizeye çevirir ve servis parolasız açılır. Artık hem kurulumda hem düzenlemede ekrana basılıyor.
  - **Ön kontroller:** port çakışması (M3.17'nin port haritasından, sahibin adıyla), panelin kendi portu (M3.18'in `panelPorts()`'u), `build:` bloğu (yapıştırılan YAML'ın yanında Dockerfile yok — bu akışta çalışmaz), `container_name` çakışması, bulunamayan `external` ağ, aynı portu isteyen iki servis, anonim volume (prune'da silinir, veri gider), eksik `restart` (sunucu yeniden başlayınca gelmez), eksik log döndürme (json-file sınırsız büyür), sabitlenmemiş sürüm etiketi. Son ikisi tek tıkla düzeltiliyor.
  - **Yeni bağımlılık:** `yaml` 2.9.0. `js-yaml` yalnızca dolaylı bağımlılık olarak vardı ve yorumları koruyamıyor.
  - **Yeni izin anahtarı açılmadı:** okuma `docker.view`, yazma `docker.action`, kurulum `apps.install`. Yeni ayar: `appstore.keep_backups` (varsayılan 5).
  - **Sunucuda doğrulanacak:** bozuk YAML gönderildiğinde yedeğin GERİ YÜKLENDİĞİ; bu görülmeden özellik güvenilir sayılmamalı.

- **M3.20** **Container penceresi sekmelere ayrıldı.** 631 satırlık tek bir kaydırma sütunu olmuştu: sağlık, ağ, compose düzenleyici, runbook, ortam değişkenleri ve ham JSON alt alta. Yeni sekmeler: Genel · Compose · Ağ · Ortam · Dosyalar · Kaynaklar · Loglar · Terminal · Inspect. Detay tek istekte okunup sekmelere dağıtılıyor; sekme değiştirmek ağ trafiği üretmiyor. **Inspect sekmesi bedava geldi**: `inspectRaw()` M1.8'den beri toplanıyordu ama bir `<details>` katlamasının içindeydi. Compose ve Terminal sekmeleri, sekme çubuğu yüklendikten sonra yerinden oynamasın diye liste verisinden karar veriliyor.

- **M3.21** **Compose düzenleyici tamamlandı; passbolt olayının üç kusuru kapandı.** M3.19'da ağ ve ortam değişkeni bölümleri **yazılmadan kalmıştı** — `setServiceNetworks` ve POST'un `networks` alanı çalışıyordu, arayüzden çağıran yoktu.
  - **İki gerçek hata:** (1) `compose/route.ts` bağlamı `networks: []` gönderiyordu ve bu, `external: true` işaretli her ağ için **sahte bir engel** üretiyordu. `CheckContext.networks` artık `string[] | null`; **`null` = "sorulamadı, atla"** ve `EMPTY_CONTEXT` `null` alıyor, böylece bağlam doldurmayı unutan her çağıran güvenli tarafa düşüyor. (2) `readService` ağları yalnızca **dizi** biçiminde okuyordu; eşleme biçiminde yazılmış bir servis "ağsız" görünüyor ve kaydedilince `aliases`/`ipv4_address` **sessizce siliniyordu**. Artık biçim korunuyor.
  - **passbolt:** 5000 portu doğru yazıldı, `compose config` geçti, `compose up` *"Bind for :::443 failed: port is already allocated"* ile patladı — 443'ü `server-panel-caddy-1` tutuyordu (16 Ağustos'tan beri; passbolt 6 Eylül'de kurulmuştu, yani **bir kez bile ayağa kalkmamıştı**). Panelin kusuru arıza değil, **sessizliğiydi**: dolu port yalnızca "uyarı"ydı, yığının durduğu anlaşılmıyordu ve yedeğe dönmenin yolu yoktu.
  - **Üç düzeltme:** dolu port `uyari` → **`engel`** (portu çalışan başka bir şey tutuyorsa `compose up` bir olasılıkla değil kesinlikle patlar; kaçış yolu "yalnızca dosyayı yaz, başlatma"); `EditOutcome.stackDown` ve kırmızı **"YIĞIN ŞU AN ÇALIŞMIYOR"** bandı + tek tıkla yedeğe dönüş (`action: "restore"`, yedek adı `<dosya>.panel-yedek-YYYYAAGG-SSDDss` kalıbına **birebir** doğrulanıyor — aksi hâlde bu uç, dizindeki herhangi bir dosyayı compose dosyasının üzerine kopyalatan bir araç olurdu); `audit()` çağrısı `compose up`'ın **sonrasına** taşındı, artık "ne denendi"yi değil "ne oldu"yu yazıyor.
  - **`environment` düzenleme:** biçim korunuyor (eşleme eşleme, dizi dizi), sır adları maskeli, `${DEĞİŞKEN}` referansları **çözülmüyor** — çözmek, `.env`'deki bir sırrı compose dosyasına kalıcı yazmak olurdu.

- **M3.22** **Container başına kaynak grafikleri.** Veri M1.6'dan beri toplanıyordu: `collectDockerMetrics` CPU ve belleği container **adını etiket alarak** `metrics_raw`'a yazıyor, T1'in rollup ve grafik makinesi bunları zaten işliyordu — eksik olan yalnızca çizimdi. Eklenenler: ağ/disk sayaçları (kümülatif yazılıp arayüzde hıza çevriliyor), `metrics/series` ucuna isteğe bağlı **`label`** süzgeci (20 container × 4 metriği popup için indirmemek adına) ve `metrics/rates.ts`. **Sayaç sıfırlanması** ayrıca ele alınıyor: container yeniden başlayınca sayaç sıfırdan sayar ve naif fark negatif hız üretir; o aralık hesaptan çıkarılıyor (sıfır yazmak "trafik yoktu" yalanı olurdu).

- **M3.23** **Container içi dosya tarayıcı.** Panelin dosya yöneticisi (M3.5) host'un dosyalarını geziyordu; container'ın içi kapalıydı ve bir yapılandırmayı düzeltmenin tek yolu terminalde `vi` idi. Docker'ın `/containers/{id}/archive` ucu üzerinden (yani `docker cp`'nin kendisi); tar okuyucu/yazıcı **elle yazıldı** (~150 satır, 9 test) çünkü tek dosya kopyalamak için bakım yükü olan bir paket eklemek orantısız.
  - **Listeleme `ls -la` ile:** arşiv ucu bir dizin istendiğinde tüm içeriği **özyinelemeli** gönderiyor — `/` için bu, dosya sistemini panele indirmek demek. Bedeli distroless/scratch imajlarda `ls`'in olmaması; o durumda boş liste değil **sebep** gösteriliyor.
  - **⚠️ Güvenlik:** bu ekran root'a eşdeğer güç veriyor (bir container'ın dosyasını değiştirmek o uygulamayı ele geçirmektir). Okuma `docker.view`, **yazma `docker.action`**; her yazma denetim kaydına düşüyor; `/proc`, `/sys`, `/dev` gezilebilir ama **yazılamaz**; boyut sınırlı (`docker.file_max_kb`, varsayılan 512). İkili dosyalar metin düzenleyiciye açılmıyor — kaydedilince bozulurlardı.

- **M3.24** **Docker listesi ve kaynak ekranı yenilendi.** Referans dockhand'in ekran görüntüleriydi ama sütun sayısını artırmak değil **sütunu seçilebilir yapmak** tercih edildi: 15 sütunu ezerek sığdırmak okunaklılığı düşürüyor. Yeni sütunlar (Image, Çalışma süresi, Ağ G/Ç, Disk G/Ç, IP, Yığın) `localStorage`'da saklanan bir seçiciyle açılıyor — kişisel bir görünüm tercihi, sunucunun ayarı değil. Seçim `useSyncExternalStore` ile okunuyor: efektten `setState` React'in kuralını ihlal ediyor, `useState` başlangıcında okumak ise sunucu render'ıyla uyuşmazlık üretiyor. Başlıklar sıralanabilir ama sıralama **grup içinde** yapılıyor; yığınları bozup tek liste vermek "bu yığın nelerden oluşuyor" bilgisini kaybettirirdi. `ContainerSummary`'ye `networkMode` ve `ipAddress` eklendi (liste API'si ikisini de zaten döndürüyordu). **Image listesi depoya göre gruplandı** — aynı imajın beş sürümü artık beş kopuk satır değil; katman geçmişi (`/images/{id}/history`) ve çalıştırma yapılandırması detay penceresinde. **Volume boyutu** eklendi ama **isteğe bağlı**: `docker system df` her volume'ü diskte yürüyerek ölçüyor, her liste açılışında yapmak sekmenin bedelini görünür şekilde artırırdı.

- **M3.25** **Ağ haritası.** "Hangi servis hangi ağda ve kim kiminle konuşabilir" sorusunun görsel cevabı; Docker sekmesindeki Ağlar görünümünde harita/liste geçişi. Kuvvet-yönlü graf yerine **kutu düzeni**: ağlar kutu, container'lar içindeki etiket — okunması kolay, her yenilemede yer değiştirmiyor ve yeni bağımlılık gerektirmiyor. `network_mode: host` ve `container:<id>` ayrıca işaretleniyor. **Asıl kazanç ağsız container'ların görünmesi:** passbolt tam olarak bu durumdaydı ve bilgi paneldeydi ama hiçbir ekran onu görünür kılmıyordu; teşhis için sunucuda `docker inspect` çalıştırmak gerekti.
  - **Kapsam dışı bırakıldı — çok host ("Environments"):** tek sunucu var, Docker'ın TCP portunu açmak o makinede root vermekle eş değer ve patlama yarıçapı N sunucuya çıkıyor. Şemadaki `host_id` sütunu kapıyı açık tutuyor; ikinci bir makine alınırsa iş, `getDockerProvider()`'ın tek daemon varsayımını gevşetmek ve bir ortam seçici eklemek olur.

- **M3.26** **Dolu port yanlış pozitifi (M3.21 gerilemesi) ve proxy ağ uyarısının metni.** Kullanıcı denemede iki şey bildirdi; biri gerçek hata, diğeri hata değil.
  - **Gerileme:** `compose/route.ts` sahibi `owner === location.service` ile eliyordu. Ama `owner.name` bir **container adı** (`passbolt-passbolt-1`), `exclude` ise bir **compose servis adı** (`passbolt`) — ikisi hiçbir zaman eşleşmedi, yani hariç tutma hiç çalışmadı. Her container kendi portunu "başkası tutuyor" sanıyordu. M3.19'da zararsız bir uyarıydı; **M3.21'de `engel`e yükseltilince düzenlemeyi tamamen kilitledi.** Düzeltme doğruydu, dayandığı veri hatalıydı.
  - **Hariç tutma CONTAINER değil PROJE bazında:** `checkCompose` belgedeki bütün servisleri denetliyor, dolayısıyla yalnızca düzenlenen container'ı elemek aynı yığındaki diğer servisler için sahte çakışma üretirdi. `compose up` zaten tüm yığını birlikte yeniliyor. Yeni saf fonksiyon `reservedByOthers` (`portmap.ts`, 8 regresyon testi) — mantık route içindeki testsiz bir satırdan saf ve testli bir modüle taşındı; hata tam olarak orada saklanıyordu.
  - **Bayat veriyle engellemek yok:** `reserved` verisi saatte bir çalışan `security.port_scan`'in önbelleğinden geliyor. Bir saatlik ölçüme dayanıp "bu portu **şu an** X tutuyor" diyerek kullanıcıyı kilitlemek, veriye hak ettiğinden fazla güvenmek olur. `CheckContext.reservedAgeSeconds` eklendi: tarama iki saatten tazeyse `engel`, değilse `uyari` ve metin verinin kaç saat önceki taramadan geldiğini söylüyor.
  - **Proxy uyarısı hata değildi.** Kullanıcının anlamadığı mesaj M2.8'den geliyor ve doğru çalışıyor. Sunucudaki veri: Caddy **tek** ağda (`server-panel_default`); uyarı almayan `server-panel-panel-1` ve `vscode-app-1` özel ayarlı değil, sadece **Caddy'nin kendi yığınındalar**. Yani "her yığın kendi ağını yaratıyor, hepsi aynı" gözlemi doğru — ve sorunun sebebi tam da bu. Metin buna göre yeniden yazıldı: önce ne olacağı (502), sonra ağların yalıtık olmasının **normal** olduğu (kullanıcı bunu "passbolt bozuk" diye okumuştu), sonra iki somut seçenek. `network_mode: host` hedefleri ayrıca karşılanıyor — Docker orada port eşlemesi bildirmediği için eski metin portsuz, yarım bir öneri veriyordu. **Davranış değişmedi**, yalnızca metin.

- **M3.27** **Panel etiketleri (`panel.*`).** Container ve imaj etiketiyle davranış kontrolü: `update` (güncellemeden muaf), `hidden` (listede gizle), `notify` (bildirim üretme), `url` ve `port.<port>.url` (tıklanabilir adres), `order` (sıra), `prune` (imajı budamadan koru). **Opt-out modeli:** varsayılan bugünkü davranış, etiket yalnızca istisna tanımlıyor — etiketi olmayan hiçbir container'ın davranışı değişmedi. Tanınmayan bir değer **varsayılana** düşüyor: bir yazım hatası yüzünden container'ın gizlenmesi sessiz ve teşhisi zor bir sürpriz olurdu. Bağlantılarda yalnızca `http/https` kabul ediliyor — etiket compose dosyasından gelip `href`'e dönüştüğü için `javascript:` şemasına izin vermek, dosyayı düzenleyebilen birine panelde betik çalıştırma imkânı vermek olurdu. `panel.hidden` **sunucuda** süzülüyor: gizleneni istemciye gönderip orada saklamak, onu ağ trafiğinde ve tarayıcı belleğinde bırakmak olurdu. **⚠️ Koda gömülü emniyet kilidi:** panelin kendi container'ı ve `proxy.caddy_container` otomatik güncellemenin dışında ve **etiketle açılamıyor** — panel kendini güncellemeye kalkarsa süreç ortasında ölür, işlem yarım kalır. Kilit arayüzde değil `updateContainerImage` içinde: o fonksiyona API ucundan, zamanlanmış işten ve toplu güncellemeden de geliniyor.

- **M3.28** **Güvenli güncelleme: etiket koruması, CVE kapısı ve env devralma.** Üç iş bir arada.
  - **Bulunan hata — env ve label donuyordu:** güncelleme yeni container'ı `{ ...raw.Config }` ile yaratıyordu, yani eski container'ın `Env` ve `Labels`'ını olduğu gibi taşıyordu ve **imajın kendi varsayılanları da eski sürümde donuyordu**. Yeni imaj `APP_VERSION=2.0` getirse bile container güncellendikten sonra eskisini gösteriyordu. Yeni saf modül `inherit.ts`: değer imajın varsayılanıyla aynıysa **düşüyor** (yeni imaj kendi değerini versin), farklıysa **korunuyor** (kullanıcının override'ı asla sessizce sıfırlanmaz). `com.docker.compose.*` etiketleri korunuyor — imajdan gelmiyorlar, container'ın hangi yığına ait olduğunun tek kaydı onlar.
  - **Safe-pull:** `docker pull` yerel etiketi çekildiği anda yeni imaja çeviriyor; çekme ile tarama arasındaki pencerede container'ın etiketi **taranmamış** bir imajı gösteriyor. Yeni sıra: çek → **etiketi hemen eski imaja geri al**, yeniye geçici `-panel-bekliyor` etiketi ver → tara → karar ver. Engellenirse geçici etiket ve yeni imaj siliniyor, container'a **hiç dokunulmuyor**. Sağlayıcıya tek yeni yetenek `tagImage`. Digest'e sabitlenmiş imajlar bu korumadan yararlanamıyor (etiketin kendisi digest) ve bu kullanıcıya **açıkça** söyleniyor; sessizce farklı davranmak en kötüsü olurdu.
  - **CVE kapısı** (`docker.update_vuln_gate`, 4 ölçüt, 13 test). Varsayılan **`daha_kotu`**, çünkü diğerlerinin hepsinin ters bir yan etkisi var: mevcut imajda zaten 5 kritik açık varken 3 açıklı yeni imajı engellemek, kullanıcıyı **daha kötü** bir yerde tutmak olur. Mevcut imajın taraması yoksa **engellenmiyor** — bilinmezliği "kötü" saymak, taranamayan her imajı dondururdu. Bugüne kadar hiç kapı olmadığı için bu bir **davranış değişikliği** ve ayar ekranında yazılı.

- **M3.29** **Yeni sürüm etiketi tespiti.** Digest kontrolü `nginx:1.24`'ün içeriği değişince haber veriyordu ama `1.26` çıktığını göremiyordu — yani "etiketini sabitle" diyip tavsiyesine uyanı kör bırakıyorduk. Yeni saf modül `version.ts` (30 test): SemVer ve CalVer aynı kalıpla, kütüphanesiz. İki incelik yolda çıktı: **sürüm kendi ön sürümünden büyük** sayılmalı (yoksa `1.5.0-rc1` kullanan nihai sürümü hiç öğrenemez) ve `1.5.0-rc1-alpine`'ın **lezzeti `alpine`**, `rc1` değil (karışsaydı lezzet süzgeci hiç öneri üretemezdi). Üç ayar: azami sıçrama, lezzeti koru, ön sürümleri dahil et. Sonuç digest kontrolünden **ayrı** gösteriliyor ve tek tıkla güncellenmiyor: yeni sürüme geçmek etiketi değiştirmek, yani compose dosyasına dokunmak demek — öneri compose düzenleyiciye yönlendiriyor.

- **M3.30** **Toplu işlem.** Container tablosuna seçim sütunu; başlıktaki kutu **yalnızca süzülmüş** satırları seçiyor. Seçim kümesi korunuyor ama **işlem her zaman görünür kesişimde** yapılıyor: "durmuşları göster"i kapattıktan sonra hâlâ seçili duran bir container'ı durdurmak, kullanıcının ekranda görmediği bir şeye dokunmak olurdu. İşlemler **sırayla** yürüyor, `Promise.all` ile değil: yirmi container'ı aynı anda yeniden başlatmak Docker'ı ve tek çekirdekli bir sunucuyu bir dakika boyunca yanıtsız bırakır, ayrıca "üçüncüde patladı, kalan dördü geçti" denemez. Biri patlasa da kalanlar deneniyor ve sonunda kimin neden geçmediği tek tek yazılıyor. Silme onayı **adları tek tek sayıyor** — "4 container silinsin mi?" demek, seçimin ne olduğunu hatırlamayı kullanıcıya bırakmak olurdu. Panelin kendisi ve proxy seçilemiyor (M3.27 kilidi); kutu gizlenmiyor, **devre dışı** çiziliyor: "unutuldu" değil "bilerek kapalı" olduğu görünsün.

- **M3.31** **Container'dan compose üretme.** Compose düzenleyicimiz yalnızca compose'a ait container'larda çalışıyordu; `docker run` ile başlatılmış olanlarda port, ağ ve env düzenleme kapalıydı ve o sekmede yalnızca bir özür metni vardı. Yeni saf modül `generate.ts` (31 test) bu köprüyü kuruyor. **Asıl iş gürültü ayıklamak:** ham inspect çıktısını olduğu gibi YAML'a dökmek üç satırlık bir servisi kırk satıra çıkarıyor ve — daha kötüsü — imajdan devralınan `Entrypoint`, `Cmd`, `Env` ve `Labels` dosyaya yazılınca **imaj güncellendiğinde eski değerler geçerli kalıyor**; M3.28'de düzelttiğimiz donma hatasının compose tarafındaki hâli. Ayrım `inherit.ts` ile aynı mantığı paylaşıyor ama `com.docker.compose.*` etiketlerinde ondan **ayrılıyor**: orada korunuyorlardı, burada atılıyorlar — compose onları kendi yazar, elle yazmak container'ı var olmayan bir projeye ait göstermek olurdu. Named volume ve ağlar `external: true` bildiriliyor: dışsal işaretlemeden bırakmak compose'un `<proje>_<ad>` önekiyle **yenilerini** yaratması, yani container'ın bomboş bir volume ile açılması demek. Yerel adres (`127.0.0.1:8080:80`) korunuyor — düşürmek kapalı bir portu dünyaya açmak olurdu. Taşınamayan her şey (anonim volume, eski usul `--link`, digest'e sabit imaj) **uyarı olarak** dönüyor: kullanıcı üretilen dosyayı "aynısı" sanıp eskisini silerse, sessizce eksik bırakılan her ayar veri ya da erişim kaybı demek.

- **M3.32** **Docker olay akışı ve OOM.** Docker'ın `/events` akışına hiç bağlanmıyorduk; `/events` ekranımız panelin **kendi** alarmlarıydı. En kritik eksik **OOM**'du: bir container bellek yetmediği için öldürüldüğünde bunu hiçbir yerde göremiyorduk. Zamanlanmış bir iş değil, `instrumentation.ts` üzerinden süreç başına **tek uzun ömürlü abonelik**; kopunca artan gecikmeyle yeniden bağlanıyor ve `since` son olayın zamanına ayarlanarak kopma boşluk bırakmıyor. Bağlanamazsa panel çalışmaya devam ediyor. Olaylar mevcut `events` tablosuna `source: "docker"` ile yazılıyor — yeni tablo yok, `/events` ekranı ve zaman tüneli onları olduğu gibi gösteriyor. **Asıl zorluk hangi `die`ın haber değer olduğu:** `docker stop` da bir `die` üretiyor ve her `die`ı bildirmek, panelin kendi durdur düğmesinin bildirim göndermesi demek olurdu. Ayrım çıkış kodunda: `0`, `143` (SIGTERM) ve `137` (SIGKILL) kasıtlıdır ve sessizdir — `137`nin OOM hâli de var ama Docker o durumda **ayrıca** bir `oom` olayı yolluyor, bildirim onun işi (18 test). Sağlık düşüşü kayda giriyor ama bildirim üretmiyor: container monitörleri (M1.2) zaten aynı durumu izliyor ve ikisinin birden bildirmesi aynı arızayı iki kez telefona düşürürdü. Docker olayları alarmlardan çok daha sık yazıldığı için **ayrı ve daha kısa** bir saklama süresine bağlandı; yeniden başlama döngüsündeki tek bir container günde binlerce satır üretebiliyor.

- **M3.33** **Volume klonlama ve dışa aktarma.** restic yedeğimiz zamanlanmış ve bütünsel; "riskli bir güncellemeden **hemen önce** şu volume'ün kopyası dursun" için bir sonraki yedeği beklemek ya da tüm depoyu geri yüklemek orantısız. Klonlamada kaynak **salt okunur** bağlanıyor — kopyalanan şey verinin kendisi olduğu için bu, geri alınamaz bir hatanın tek gerçek koruması. Sürücü, seçenekler ve etiketler korunuyor (sağlayıcıya `createVolume` eklendi): NFS üzerindeki bir volume'ün kopyası yerel diskte oluşursa "kopya" aslıyla aynı davranmaz. Compose'un kendi etiketleri **kopyalanmıyor** — kopya o yığına ait değil ve ait göstermek `compose down --volumes` ile silinmesine yol açardı. Kopyalama yarıda kalırsa hedef volume siliniyor: dolu sanılan boş bir volume bırakmak, "işlem başarısız" mesajını yalan yapardı. **⚠️ Kullanımdaki bir volume'ü kopyalamak** çalışan bir veritabanının dosyalarını o yazarken kopyalamak olabilir; engellenmiyor ama kullanan container varsa onay metninde adlarıyla söyleniyor. Dışa aktarma container'ı **başlatmadan** `docker cp` ile yapıyor ve boyut **önceden** kontrol ediliyor — arşiv belleğe alınıyor ve 20 GB'lık bir volume'ü indirmeye kalkmak paneli belleksiz bırakır; Docker boyutu hesaplayamadıysa engellenmiyor, bilinmezliği yasak saymak ölçülemeyen her volume'ü kilitlerdi. Dosya yöneticisi `?path=` ile doğrudan açılabilir hale getirildi (planda var sanılıyordu, yoktu).

- **M3.34** **Cilalar.** **ANSI renkleri** (`ansi.ts`, 22 test): log görüntüleyici kaçış dizilerini ham metin olarak basıyordu ve renkli log üreten uygulamalarda satırlar okunmuyordu. En önemli karar **tanınmayan dizinin atılması**: ANSI'de renkten başka çok şey var (imleç taşıma, ekran temizleme) ve bir log görüntüleyicide karşılıkları yok — tanımadığını ham basmak, düzeltmeye çalıştığımız sorunun ta kendisi olurdu. Renkler panelin kendi paletine eşleniyor, yani tema değişince loglar da değişiyor. Arama **ANSI'den arındırılmış** metinde yapılıyor: renk kodlarının içinde eşleşme bulmak ya da renkli bir kelimenin ortasındaki kaçış dizisi yüzünden eşleşmeyi kaçırmak, ikisi de yanlış sonuç verirdi. **Log indirme** (.txt, ANSI'siz, süzgeç uygulanmış hâliyle) ve **yazı boyutu**. **Terminalde kabuk ve kullanıcı seçimi**: `docker.exec_shell` ayarı tüm container'lar için tek değerdi ve bash'i olanla olmayan arasında geçiş yapmanın tek yolu ayarı değiştirmekti; seçim artık oturum başına, ayar varsayılan olmayı sürdürüyor. İkisi de **beyaz listeden** geçiyor — ham dize `docker exec`e komut ve `-u` olarak gidiyor. Yazı boyutu oturumu kapatmadan uygulanıyor. **Compose bulgularına satır numarası:** iki yüz satırlık bir dosyada "web servisinde restart yok" demek kullanıcıyı o satırı aramaya bırakmaktı; konum bilgisi `yaml` düğümlerinde zaten vardı, kullanmamak elimizdeki bilgiyi saklamaktı. Satır **tek yerde** yazılıyor (`service` + `anchor` alanlarından türetiliyor), her bulgu üretim noktasında ayrı ayrı değil — yeni bir kontrol eklerken unutulacak bir adım olurdu. **Arayüz ölçeği** (%80-120): tablolar M3.24'te yoğunlaştı ve tek bir "doğru" boyut yok; kök `rem` boyutu değiştiği için yazıyla birlikte boşluklar da orantılı büyüyor. `localStorage`'da, çünkü mesele cihazın ekranı — ayar tablosuna yazmak, iki farklı cihazdan giren aynı kullanıcının birindeki seçiminin diğerini de değiştirmesi demek olurdu.

- **M3.35** **Bakım sayfası çökmesi: eski önbellek satırlarında eksik alanlar.** Güncelleme kontrolünün sonucu diskte tutuluyor ve günde bir yenileniyor — yani panelin YENİ sürümü, ESKİ sürümün yazdığı satırları okuyor. M3.27 `updatable`/`skipReason`, M3.29 `newerTag` ekledi ve eski satırlarda bu alanlar hiç yoktu. Ekran `newerTag !== null` diye süzüyordu; **`undefined !== null` doğru** olduğu için eski satırlar süzgeci geçti ve `newerTag!.tag` okundu: `TypeError: Cannot read properties of undefined (reading 'tag')` — bakım sayfası hiç açılmıyordu. Düzeltme ekranda değil **önbelleği okurken**: `cachedImageUpdates` her satırı güncel şemaya tamamlıyor, böylece önbelleğin her tüketicisi (bakım ekranı, alarm koşulları) aynı korumayı alıyor. Ekrandaki non-null iddiaları daraltılmış tiple değiştirildi — iddia bir kez yalan söyledi, aynı hatayı derleyici yakalasın. Saf modül `normalize.ts` + 6 regresyon testi.

- **M3.36** **Docker tablosunda sütun kayması: eksik Image başlığı.** Gövdede Image hücresi vardı, başlıkta karşılığı yoktu (M3.24'ten beri) ve adın sağındaki HER sütun bir kayıyordu: "Durum" başlığı imajın, "CPU" çalışma süresinin üstünde duruyordu. Kök sebep başlığın ve hücrelerin **ayrı ayrı yazılmış** olması — iki `visible.has(...)` zinciri, yüz satır arayla, elle senkron tutuluyordu. Başlıklar artık `COLUMNS`'tan üretiliyor; başlık metni ve sıralama anahtarı da sütun tanımında. Bu, başlık sayısının görünen sütun sayısıyla aynı olmasını garantiliyor.

- **M3.37** **Stack sekmesi ve düz container listesi.** İlk tasarım container listesini yığına göre gruplamaktı; kullanıcı reddetti: *"defterim, home assistant ve zigbee2mqtt aynı şey değil ki gruplansın. çok saçma, stack mantığı bu değil."* Sunucudaki 13 compose projesinin **8'i tek container'lık** — compose ile başlatılmış olmak bir uygulamayı yığın yapmıyor ve grup başlıkları birbiriyle ilgisi olmayan uygulamaları anlamlı bir ortaklıkları varmış gibi gösteriyordu. `composeProject` teknik bir alan: bir **sütun** olabilir (var), listeyi bölme ölçütü olamaz. Gruplama kaldırıldı, yığın yönetimi kendi sekmesine taşındı.
  - **Yeni bir özellik değil, toparlanma:** yığına dokunan her parça zaten yazılmıştı ama üç yere dağılmıştı — `/appstore` (kurulum), `/host` (compose komutları), container popup'ı (tek servis düzenleme). Sekme onları tek adrese getiriyor; altındaki uçlar aynı uçlar. `/appstore` `/docker?tab=stack`'e **yönlendiriliyor** (kayıtlı bağlantılar kırılmasın; `docker.view` izni olmayana sebebi yazılıyor), `/host`'taki yinelenen üç düğme kalktı.
  - **Kurulum ucu taşınmadı:** `installComposeStack` diske compose dosyası yazan tek yol ve sınanmış bir boru hattı; ekranı taşımak için altındaki yazma yolunu yeniden bağlamak, hiçbir şey kazandırmayan bir regresyon riski olurdu.
  - **Liste iki kaynağı birleştiriyor** (`stacks.ts`, 17 test): container etiketlerinden keşif + `app_stacks` kayıtları. Sebebi somut: **kurulumu başarısız olan bir yığının container'ı yoktur** ve etiket keşfinde hiç görünmez — passbolt olayında yaşanan çıkmaz tam olarak buydu. Sayılar süzülmemiş veriden geliyor; arama satırları süzüyor ama `2/3` her zaman gerçeği söylüyor.
  - Container satırı `ContainerRow`'a çıkarıldı ve iki sekmede de kullanılıyor. Kopyalamak, zamanla ayrışan iki satır demekti — M3.36'da başlık/hücre çiftinde tam olarak bu olmuştu.

- **M3.38** **Sekme adları ve ortak araç çubuğu.** Çoğul ekleri kalktı (`Container'lar → Container`). Arama yalnızca Container sekmesindeydi, **yenileme hiçbir yerde yoktu** (kaynak listeleri sekmeye ilk girişte bir kez çekiliyor, sunucuda bir şey değişince sayfayı yeniden yüklemek gerekiyordu), temizlik ayrı bir sekmenin arkasındaydı. Üçü de artık her sekmede aynı yerde; temizlik sekme başına **dar kapsamlı** (Image sekmesinde yalnızca kullanılmayan imajlar), Temizlik sekmesindeki toplu panel duruyor.

- **M3.39** **Image dışa aktarma ve etiket yönetimi.** `docker save` karşılığı tar indirme (boyut önden sınırlanıyor — arşiv belleğe alınıyor, M3.33'ün aynı gerekçesi) ve etiketleme. **"Yeniden adlandırma" bilerek yok:** Docker'da imajın adı yoktur, etiketleri vardır; arayüzde "Etiketle / Etiketi kaldır" deniyor ve ikisi ayrı tutuluyor ki arada bir şey ters giderse ne olduğu görünsün. Bu iş sırasında referans ayrıştırmasının **üç kopyası** bulundu (güncelleyici, image listesi, yeni akış) ve `reference.ts`'te birleştirildi — üçü de aynı ince kuralı taşıyordu: son iki nokta son eğik çizgiden önceyse etiket değil kayıt defteri portudur. Birleştirme sırasında kayıt defteri ana bilgisayarının hiç doğrulanmadığı da ortaya çıktı ve doğrulama eklendi (13 test).

- **M3.40** **Volume sekmesi.** `Oluşturulma` ve `Yığın` sütunları; kullanan container adı artık **bağlantı** (detay popup'ını açıyor), yığın adı Stack sekmesine götürüyor. **Dosya listesi popup'a taşındı:** eski "Gözat" bağlantısı `/files` sayfasına gidiyordu ve orası çoğu zaman **açılmıyordu** — volume mountpoint'i `files.roots` içinde değil ve dosya yöneticisi izinli kökler dışına çıkmıyor, yani bağlantı çalışmayan bir yere götürüyordu. Yeni yol o kısıttan bağımsız: volume tek seferlik bir container'a salt okunur bağlanıp `ls -la` çalıştırılıyor ve çıktı mevcut `parseListing` ile ayrıştırılıyor. Yalnızca kök dizin listeleniyor — amaç silmeden önce "içinde ne var" sorusuna hızlı cevap vermek, ikinci bir dosya yöneticisi kurmak değil.

- **M3.41** **Ağ sekmesi.** Ağlar genel üç sütunlu tabloyu paylaşıyordu (ad, kullanan, sil); ağın kendi bilgisi görünmüyordu ve **ağ oluşturmanın yolu yoktu** — panelden bir yığın kurulabiliyor ama ona ağ verilemiyordu. Yeni tablo: ad · sürücü · kapsam · subnet · gateway · bağlı container · işlem. Ağ oluşturma (sürücü, internal, attachable, etiketler, IPAM), detay popup'ı, container bağlama/çıkarma, kimlik kopyalama, ağ çoğaltma ve silme. IPAM alanları boşken gövdeye **hiç yazılmıyor** — boş bir subnet Docker'da "invalid CIDR" hatası. Varsayılan görünüm **listeye** çevrildi: harita topoloji sorusunu iyi cevaplıyor ama sekmedeki işlerin çoğu tabloda ve kullanıcı her seferinde görünüm değiştirmek zorunda kalıyordu. **Sürücü listesi `bridge` ve `overlay` ile sınırlı:** `macvlan`/`ipvlan` önce listeye kondu, sonra sunucuda ölçülüp çıkarıldı — parent arayüz olmadan Docker ağı **hatasız yaratıyor** ama o ağa bağlanan container dışarı çıkamıyor (`ping: sendto: Network unreachable`). Panel "başarılı" deyip bozuk bir ağ kurdurmuş oluyordu; desteklemediğimiz bir seçeneği sunmaktansa sunmamak doğru. Sürücü sunucuda da beyaz listeden geçiyor — bu uç API token'ıyla da çağrılabiliyor ve Docker hata vermediği için tek savunma orası. dockhand'in diyaloğundaki *"hostname"* alanı **yazılmadı**: Docker'ın ağ API'sinde karşılığı yok (hostname container'a ait, ağa değil) ve olmayan bir ayarı varmış gibi göstermek yanlış olurdu.

- **M3.42** **Ayarlar sekmeleri.** 19 kategori bugüne kadar yalnızca menüdeki açılır listedeydi; bir kategoriden diğerine geçmek menüyü açıp doğru başlığı bulmayı gerektiriyordu. Sayfaya yatay sekme çubuğu eklendi, kaynağı `settings.schema.ts` — menü de aynı listeden besleniyor, ikinci bir liste tutmak şemaya eklenen bir kategorinin birinde görünüp diğerinde görünmemesi demekti.

- **M3.43** **Görsel katman yığını.** Katmanlar büyükten küçüğe sıralı bir metin listesiydi ve her satır Docker'ın ham `CreatedBy` çıktısını basıyordu (`/bin/sh -c #(nop)  CMD ["node"]`). İki kayıp vardı: **sıralama yığını bozuyordu** (katmanlar bir yığın; hangisinin hangisinin üstüne bindiği imajın nasıl kurulduğunu okumak demek) ve **ölçek görünmüyordu** ("169.98 MB" ile "20 KB" yan yana iki metin, aradaki 8000 katlık farkı gözle yakalamak mümkün değil). Artık her katman uzunluğu boyutla orantılı renkli bir çubuk; satıra tıklamak tam komutu, payı ve tarihi açıyor. Ayrıştırma saf modülde (`layers.ts`, 20 test) ve en kritik iddiası **RUN'ın tanınması**: Docker `RUN`'ı komut adıyla yazmıyor, doğrudan kabuk çağrısı bırakıyor — tanınmazsa imajın boyutunu domine eden katmanlar (ki neredeyse her zaman RUN'dır) etiketsiz kalır ve ekranın tek amacı boşa giderdi. BuildKit'in `RUN /bin/sh -c … # buildkit` biçimi de aynı satıra normalize ediliyor. **Büyük** damgası iki koşulu birlikte istiyor: imajın %20'sinden fazlası VE en az 10 MB — yalnızca orana bakmak 40 MB'lık bir imajın 9 MB'lık katmanını damgalardı, yalnızca mutlak eşiğe bakmak 2 GB'lık imajda her katmanı büyük gösterirdi. Numaralandırma tabandan: Docker geçmişi en yeniden en eskiye veriyor ama kullanıcı imajı Dockerfile okur gibi düşünüyor ve orada ilk satır tabandır.

- **M3.44** **Kaynak sekmelerinin kullanılabilirlik düzeltmeleri.** Kullanıcı denemede altı şey bildirdi; ikisi eksik özellik, dördü **var olan ama görünmeyen** özellikti.
  - **Silme düğmeleri gizleniyordu.** Volume ve ağ satırlarında silme yalnızca `removable` iken çiziliyordu; kullanımdaki her kaynakta düğme hiç yoktu ve kullanıcı *"silme eklenmemiş"* sanıyordu. Artık **hep çiziliyor**, silinemiyorsa devre dışı ve ipucu sebebini söylüyor (`Silinemez — kullanan: passbolt, passbolt-db`). Aynı ilke M3.30'daki kilitli seçim kutusundan geliyor: bir şeyi gizlemek "yok" demekle aynı şey.
  - **Volume oluşturma yoktu.** Sağlayıcıda `createVolume` M3.33'ten beri vardı ama yalnızca klonlama kullanıyordu. Diyalogda sürücü seçenekleri açıkta: `local` sürücünün asıl gücü orada (`type=nfs`, `o=addr=…`, `device=:/yol`) ve sunmamak kullanıcıyı sunucuda `docker volume create` yazmaya geri gönderirdi.
  - **Ağ bağlama `prompt()`'tu** ve container adını ELLE yazdırıyordu — adı hatırlamak, doğru yazmak ve zaten bağlı olup olmadığını bilmek kullanıcıya kalıyordu. Artık açılır listeli diyalog; zaten bağlı olanlar listede yok (Docker onları reddediyor, göstermek kesin bir hataya davet olurdu). **Ağdan çıkarma** da artık "hangisi?" diye sormuyor: detay penceresinde her container'ın kendi satırı ve kendi düğmesi var, geriye yalnızca onay kalıyor.
  - **Ağ oluşturma formu varsayılanlarla doluyor** — boş bir form "buraya ne yazmalıyım" sorusu sorar, dolu bir form hem çalışan bir örnek verir hem biçimi gösterir. Subnet bilerek boş: Docker'ın kendi havuzundan seçmesi neredeyse her zaman doğru olan ve dolu bir subnet kullanıcıyı çakışma riskine sokar.
  - **Volume dosya tarayıcısı gezinilebilir oldu.** M3.40'ta yalnızca kök dizin listeleniyordu — bilinçli bir sınırdı ama yetmedi: bir volume'ün ne taşıdığını anlamak neredeyse her zaman bir alt dizine girmeyi gerektiriyor. Artık kırıntı yolu, alt dizin ve dosya indirme var. **Salt okunur kalıyor:** volume kalıcı veri ve çoğu zaman çalışan bir veritabanının canlı dosyaları; altından düzenlemek kurtarılamayan bir bozulma olabilir. Listeleme `docker.view` ile, dosya İÇERİĞİ okuma `docker.action` ile — bir volume'ün içinde parola ya da anahtar olabilir. Yol `normalizePath` ile temizlenip mount noktasının altında olduğu ayrıca sınanıyor; aksi halde `../../etc/passwd` container'ın kendi kökünü okuturdu.
  - **Üst çubuktaki yazı ölçeği düğmesi kaldırıldı.** M3.34'te istenmeden eklenmişti.

- **M3.45** **Ayarlarda seçim alanları, dostane zamanlama ve HTTP-only panel.** Elle yazılan alanların çoğu **sessiz arıza** üretiyordu: yanlış yazılmış bir container adı, var olmayan bir dizin ya da host'ta bulunmayan bir kullanıcı kabul ediliyor, kaydediliyor ve iş çalışmıyordu. Hepsi seçime çevrildi — **depolama biçimi değişmedi** (virgüllü metin, `uid:gid`), yalnızca giriş yolu. Yeni ayar tipleri: `container`, `containers`, `dir`, `dirs`, `owner`, `richtext`. `proxy.caddy_container` ve `logs.sources` `/api/docker` listesinden, `appstore.stacks_dir` ile `files.roots` host klasör gezgininden (`/api/host/dirs`), `appstore.file_owner` host'un `/etc/passwd` + `/etc/group` listesinden (`/api/host/users`) seçiliyor. `welcome.notice` zengin metne çevrildi; çıktı **beyaz listeli sanitizer'dan iki kez** geçiyor (hem kaydederken hem çizerken — biri atlanırsa depodaki eski kayıt korumasız kalırdı). Host görevlerinde ham cron kutusu kalktı, yerine "her N günde bir, saat 06:17" diyebilen `CronEditor` geldi; çalıştıran kullanıcı da açılır liste. Servis ekleme formunda `container` tipinde container seçimi var ve **ad alanını boşsa dolduruyor**; özel zamanlama kutuları placeholder değil **gerçek değerle** geliyor. Sayfa geçişlerinde `loading.tsx` iskeleti + tıklanan menü maddesinde bekleme göstergesi. **Panel yalnızca HTTP:** Caddy'deki `tls internal` bloğu kalktı ve oturum çerezinin `secure` bayrağı `X-Forwarded-Proto`dan okunuyor — sabit `true` iken HTTP üzerinden giriş **sessizce başarısız oluyordu**; 443 yalnızca yayınlanan siteler için duruyor.

- **M3.46** **Konteyner ekleme.** Panelde container ayağa kaldırmanın tek yolu compose'du: kullanıcı bir YAML yazacak, onu host'un izin verdiği bir dizine kurduracak ve host-helper'ın `compose up` çalıştırmasını bekleyecekti. Tek servislik bir uygulama için bu gereksiz ağırlıktı — sağlayıcıda `createContainer` zaten vardı ama yalnızca panelin İÇ işleri (imaj güncelleme, geçici volume container'ları) kullanıyordu.
  - **Düğme Container sekmesinde, akış popup'ta.** Container eklemek container listesinin işi; eskiden ayrı bir ekrandı ve kullanıcı sonucu görmek için geri dönmek zorundaydı. Popup'ta iki başlangıç noktası var — **Compose YAML** ve **Image çek** — ama tek form: ikisi de `ContainerCreateForm`'u ÖN DOLDURUYOR. Ayrı iki oluşturma akışı yazmak, port doğrulamasını iki yerde tutmak demekti.
  - **Hiçbir adım container YARATMIYOR.** YAML okumak da, image çekmek de yalnızca formu dolduruyor; container ancak "Konteyner oluştur" düğmesine basılınca var oluyor. Kullanıcının açık isteği buydu ve doğrusu da bu: bir imajı indirmek onu çalıştırmak istediğin anlamına gelmiyor. `/api/docker/from-compose` sunucuya **hiçbir şey yazmıyor** — dosyayı ayrıştırıp container tanımına çeviriyor, o kadar.
  - **Çevrilemeyen sessizce düşmüyor.** `${PORT}:80` ya da `3000-3005:3000-3005` tek bir container tanımına çevrilemiyor; satır atlanıyor ve **uyarı** üretiliyor. Anonim volume (`- /data`) de öyle: kaynağı olmayan bir bind Engine'e verilemez. Uyarı üretilmezse kullanıcı portunun yayınlanmadığını ancak servise erişemeyince anlardı.
  - **Boş alan gövdeye YAZILMIYOR.** Docker'da `Cmd: []` imajın kendi komutunu EZER ve container hiçbir şey çalıştırmadan çıkar; aynı tuzak `Entrypoint`, `User` ve `WorkingDir` için de geçerli. Panel "dokunulmadı" ile "boşaltıldı"yı ayırıyor (31 test, `spec.test.ts`).
  - **Başlatma başarısız olursa container SİLİNMİYOR.** İlk tasarım geri alıyordu ve yanlıştı: başlatma hatalarının çoğu (port dolu, volume yolu yok, mimari uymuyor) container'ın loglarında yazıyor ve container silinince o kanıt da gidiyordu. Kayıt duruyor, panel ne olduğunu söylüyor, kullanıcı düzeltip başlatıyor.
  - **Çok servisli dosyada seçim soruluyor.** Sessizce ilkini almak istenmeyen servisi açardı; hepsini birden oluşturmak "hiçbir şey otomatik oluşmayacak" kuralını çiğnerdi. Birbirine bağlı bir yığını compose'un kendisiyle (tek `compose up`, bağımlılık sırası) kaldırmak ayrı bir iş ve yeri **Stack sekmesi** olarak kaldı.
  - **Uzun container adı satırı şişirmiyordu artık.** Ad hücresi `md` üstünde sınırlı genişlikte ve kesiliyor; sınır olmadan uzun bir ad hücreyi kelime kelime sarıyor ve tüm satırı dikeyde iki-üç kat büyütüyordu. Dar ekranda (kart düzeni) sarma korunuyor — kesilen bir ada karta sığdığı hâlde ulaşamamak olurdu. Tam ad her koşulda `title`'da.
  - **Üstbarda tema düğmesi.** Sol uçta, çünkü sağ taraf günde on kez basılan düğmelerle dolu. Tercih `localStorage`'a yazılıyor (tema cihaza bağlı bir görünüm kararı) ve açılış betiği ilk boyamadan ÖNCE aynı anahtarı okuyor; sıra tersine olsaydı koyu temayı kapatan kullanıcı her açılışta bir kare koyu ekran görürdü. Düğmenin React durumu **yok**: simgeler `.dark` sınıfına bakan CSS varyantıyla seçiliyor, böylece sunucunun bilemeyeceği bir değeri hidrasyonda tahmin etmek gerekmiyor.

Aşağıdaki bölümler her fazın özellik/davranış/veri/API detayını içerir.

---

## FAZ 1 — Detay

**İzleme:** CPU/RAM/Disk/Ağ/Uptime kartları + canlı grafik (rollup'lu uzun dönem trend); **sıcaklık + S.M.A.R.T + RAID/ZFS havuz sağlığı** (degraded/resilver/scrub); uptime geçmişi (`uptime_log`); **kapasite tahmini** ("disk N gün sonra dolar").
**Docker/Sistem Yönetimi:** container tablosu + start/stop/restart, canlı log (SSE), **image/volume/network yönetimi**, `inspect`, **bağımlılık grafiği**, restart policy/env/port düzenle→recreate, **web terminal**, **compose/stack yönetimi**, **tek-tık image update**, **prune**; **güç (reboot/shutdown) + systemd** (host-helper).
**Bilgilendirme:** backup klasörü takibi (eski/eksik uyarısı); **OS güncelleme** (apt, `os-updates.sh`); **image güncelleme** (`image-updates.sh`).
**Alarm/Olay:** eşik (CPU/RAM/disk/sıcaklık), container/uptime down, restart-loop, S.M.A.R.T arıza, **RAID degraded / scrub gecikmesi**, backup eski, güncelleme mevcut, kapasite projeksiyonu → Telegram + HA + ntfy/Discord/e-posta + `events`. **Bakım penceresinde alarm susar**; tekrarlayan alarm dedup edilir, flap eden servis N kez üst üste doğrulanmadan bildirilmez.

Veri: `metrics_raw/1m/1h/1d`, `monitors`, `uptime_log`, `maintenance_windows`, `alert_state`, `storage_pools`, `runbooks`, `events`, `settings`. Host: `scripts/{os-updates,image-updates,smart}.sh`, `host-helper/`.

## FAZ 2 — Detay

Kategorili kart ızgarası (durum noktalı), **"+ Ekle"** modal (başlık/port/protokol/kategori/logo veya favicon), düzenle/sil; **servis widget'ları** (canlı veri); **Docker label ile otomatik kart**; **ana sayfa** (arama + bookmark + saat/hava durumu); **reverse proxy yönetimi** (subdomain + otomatik HTTPS + sertifika bitiş alarmı + DDNS); **ağ keşfi** (cihaz envanteri + yeni cihaz uyarısı); **Tailscale** (peer listesi + key expiry alarmı + Serve ile yayınlama); **Wake-on-LAN**; **speedtest geçmişi**; yapılandırma **export/import**. Kart tıklaması → `{protocol}://{HOST}:{port}{path}` (`HOST`=`window.location.hostname`, `SERVER_HOST` override) veya proxy tanımlıysa subdomain.

Veri (eklenir): `apps`, `categories`, `bookmarks`, `wol_devices`, `speedtest`, `proxy_hosts`, `certificates`, `ddns_records`, `network_devices`.

## FAZ 3 — Detay

Kullanıcı/rol yönetimi + 2FA + audit görüntüleyici; olay/bildirim merkezi; merkezi log arama; yedekleme motoru; web dosya yöneticisi + disk kullanım analizi; **veritabanı yöneticisi**; ufw firewall + açık portlar; fail2ban/başarısız login/CVE taraması; cron yönetimi; app store (compose şablon); otomasyon (kural motoru) + webhook + API token + Prometheus `/metrics` + MQTT yayını; komut paleti + widget özelleştirme.

**Veritabanı Yöneticisi:** Panelde yerleşik, Adminer/phpMyAdmin tarzı bir veri arayüzü. Sunucudaki DB container'ları otomatik keşfedilir (image adından motor, bağlantı bilgileri container env'inden önerilir); elle bağlantı da eklenebilir, parolalar şifreli tutulur. Sol tarafta veritabanı/şema/tablo ağacı, sağda sayfalanmış veri grid'i (sıralama, sütun filtresi, satır detayı) ve **Yapı** sekmesi (sütun tipleri, index, foreign key). SQL editöründe sorgu çalıştırılır; sonuç grid'i, süre, etkilenen satır sayısı gösterilir, çıktı CSV/JSON olarak indirilebilir. Sorgu geçmişi kullanıcı bazlı tutulur, sık kullanılanlar kaydedilebilir. **Varsayılan salt-okunur:** yazma yetkisi bağlantı bazında ve `db.write` izniyle açılır; her yazma/şema sorgusu audit'e düşer; `WHERE`'siz `DELETE`, `DROP` ve `TRUNCATE` ek onay ister. Sorgu zaman aşımı ve döndürülecek satır limiti ayarlardan gelir — kazara açılan devasa bir `SELECT` paneli kilitlemez.

**Merkezi Log Arama:** Docker container logları ve host `journald` çıktısı job runner tarafından toplanıp SQLite **FTS5** tablosuna yazılır (saklama süresi ayarlanabilir, budama otomatik). UI'da kaynak/seviye/zaman filtresi + tam metin arama. Tanımlı pattern'ler (ör. `OOM`, `authentication failure`) eşleşince `events`'e olay + bildirim.

**Yedekleme Motoru:** restic ile zamanlanmış yedek işleri — kaynak olarak host dizini veya Docker volume seçilir, hedef yerel backup klasörü ve/veya off-site (rclone/S3). Retention politikası (günlük/haftalık/aylık kaç snapshot). Panelden snapshot listesi, içerik gözatma ve **tek tık geri yükleme**. Panelin kendi SQLite'ı `VACUUM INTO` ile tutarlı şekilde yedeğe dahil edilir. Faz 1'deki backup takibi bu işlerin sonucunu izler ve başarısız/eski yedeğe alarm üretir.

**Kapsam dışı (2026-07-27):** Home Assistant entity/servis entegrasyonu, Depolar (GitHub senkron + GitOps + config snapshot) ve Şifre Kasası (Vaultwarden entegrasyonu) yapılmayacak. Bunların yerini tutan şeyler duruyor: HA'ya **bildirim** gönderme Faz 1'den beri çalışıyor ve M3.11'in **MQTT yayını** panel metrik/olaylarını HA'ya taşıyarak otomasyonu HA tarafında yazılabilir kılıyor; Vaultwarden app store katalogunda **şablon** olarak duruyor (tek tıkla kurulur, panel entegrasyonu olmaz).

Veri (eklenir): `logs` (FTS5), `backup_jobs`, `backup_runs`, `vuln_scans`, `automations`, `webhooks`, `api_tokens`, `app_templates`. Yeni host-helper/script: ufw, fail2ban, cron, dosya işlemleri (hepsi whitelist + audit). (`host_cron_jobs` M3.9'da gereksiz bulundu; `repos` kapsam dışı.)

---

## Ayarlar Kataloğu

Aşağıdaki değerler **varsayılandır**; hepsi Ayarlar ekranından değiştirilebilir (T9). ⭐ = kaynak bazında (container/app/repo) ezilebilir. 🔒 = T3 ile şifreli saklanır.

**Genel** (`general.*`)
`language` (tr/en) · `theme` (açık/koyu/sistem) · `timezone` (Europe/Istanbul) · `date_format` · `ui_refresh_interval` (5 sn) · `default_landing_page` · `kiosk.enabled` (kapalı) / `.token` 🔒 / `.refresh_interval` / `.apps` (kioskta gösterilecekler)

**İzleme & Saklama** (`monitoring.*`)
`collect_interval` (5 sn, 5–60) · `retention.raw_hours` (24) · `retention.minute_days` (7) · `retention.hour_days` (90) · **`retention.day_months` (24 ay, 1–120)** · `rollup_cron` · `chart_default_range` (24h) · `disks` (izlenecek mount'lar) · `net_interfaces`

**Health-check** (`health.*`)
`interval` ⭐ (60 sn) · `timeout` ⭐ (10 sn) · `retries` ⭐ (3) · `down_threshold` ⭐ (3 ardışık) · `uptime_retention_months` (12)

**Alarm & Eşik** (`alerts.*`)
`cpu.warn/crit` (80/95 %) · `ram.warn/crit` (85/95 %) · `disk.warn/crit` ⭐ (80/90 %) · `temp.warn/crit` (70/85 °C) · `flap_threshold` (3 ardışık) · `dedup_window` (30 dk) · `escalate_after` (60 dk, 0=kapalı) · `quiet_hours.enabled/start/end` · `quiet_hours.critical_bypass` (açık) · `channels.telegram.min_level` · `channels.ha.min_level` · `capacity_forecast_days` (14)

**Bildirim kanalları** (`notify.*`) — her kanalın kendi `min_level`'i var
`telegram.enabled` / `.token` 🔒 / `.chat_id` · `ha.enabled` / `.url` / `.token` 🔒 / `.service` · `ntfy.enabled` / `.url` / `.topic` / `.token` 🔒 · `discord.enabled` / `.webhook` 🔒 · `email.enabled` / `.smtp_host` / `.port` / `.user` / `.password` 🔒 / `.from` / `.to`

**Donanım** (`hardware.*`)
`temp_sources` (izlenecek sensörler) · `smart_scan_cron` · `raid.enabled` (otomatik algıla) · `raid.scrub_overdue_days` (35 → uyarı)

**Dışa açılma** (`integrations.*`)
`prometheus.enabled` (kapalı) / `.token` 🔒 · `mqtt.enabled` (kapalı) / `.broker` / `.username` / `.password` 🔒 / `.topic_prefix` / `.publish_interval`

**Docker** (`docker.*`)
`stats_interval` (5 sn) · `log_tail_lines` (200) · `autoprune.enabled` (kapalı) · `autoprune.cron` · `autoprune.scope` (dangling / kullanılmayan image / tümü) · `autoprune.keep_days` · `update_check_cron` (günlük) · `auto_update.enabled` ⭐ (**kapalı** — güvenlik) · `registry.username` / `.token` 🔒 (Docker Hub anonim çekimde 6 saatte 100 pull sınırına takılır; çok image varsa kimlik gerekir) · `restart_loop.window` (10 dk) / `.threshold` (3 restart → alarm)

**Yedekleme** (`backup.*`)
`enabled` ⭐ · **`cron` ⭐ (`0 3 * * *`)** · **`keep_last` ⭐ (7)** · `keep_daily/weekly/monthly` (7/4/6) · `target_dir` · `offsite.enabled` / `.remote` · `quiesce` ⭐ (yedek öncesi container durdur, kapalı) · `retry_count` (2) · `stale_after_hours` (36 → alarm) · `min_free_disk_gb` (10) · `verify_after` (restic check) · `db_backup_cron` (panel SQLite)

**Log arama** (`logs.*`)
`enabled` ⭐ (container bazında log toplamayı aç/kapa) · `retention_days` (14) · `max_size_mb` (2048) · `collect_interval` · `journald.enabled` · `alert_patterns` (regex + seviye listesi)

**Ağ** (`network.*`, `speedtest.*`)
`scan.enabled` · `scan.cidr` · `scan.cron` · `scan.alert_new_device` (açık) · `device_offline_after_hours` · `speedtest.cron` · `speedtest.retention_months` (12)

**Proxy, Sertifika & DDNS** (`proxy.*`, `ddns.*`)
`provider` (npm / caddy / yok) · `base_domain` · `cert_expiry_warn_days` (21) · `ddns.enabled` (kapalı) · `ddns.provider` (cloudflare / duckdns) · `ddns.token` 🔒 · `ddns.records` · `ddns.check_interval` (10 dk)

**Tailscale** (`tailscale.*`)
`enabled` (kapalı) · `socket_path` (`/var/run/tailscale/tailscaled.sock`) · `api_key` 🔒 (tailnet geneli sorgular için) · `tailnet` · `poll_interval` (60 sn) · `key_expiry_warn_days` (14 → alarm) · `alert_peer_offline` (kapalı) · `alert_relay_fallback` (açık — direct bağlantı DERP'e düşerse uyar) · `serve.enabled` ⭐ (servis bazında tailnet'e yayınlama) · `funnel.enabled` ⭐ (**kapalı** — herkese açık internet, ayrı onay ister)

**Güvenlik** (`security.*`)
`session_ttl_hours` (12) · `remember_me_days` (30) · `login_max_attempts` (5) · `lockout_minutes` (15) · `require_2fa` (kapalı) · `cve_scan_cron` (haftalık) · `cve_alert_level` (high) · `audit_retention_months` (24) · `upnp_scan.enabled` (açık) / `.cron` · `external_scan.enabled` (**kapalı** — IP'yi üçüncü tarafa bildirir) / `.provider` / `.cron`

**Veritabanı yöneticisi** (`db.*`)
`autodiscover` (açık — Docker'dan DB container'larını tanı) · `query_timeout` (30 sn) · `max_rows` (1000) · `page_size` (50) · `write_enabled` ⭐ (**kapalı** — bağlantı bazında açılır) · `confirm_destructive` (açık — WHERE'siz DELETE / DROP / TRUNCATE ek onay) · `audit_reads` (kapalı — SELECT'ler audit'i boğmasın) · `history_retention_days` (90) · `export_max_rows` (50000)


## Veri Modeli (özet)
```
Temel:  hosts, users, roles, permissions, role_permissions, audit_log, events,
        settings(key, scope_type, scope_id, value,
                 value_encrypted, iv, auth_tag, updated_at, updated_by),
        jobs, job_runs, job_locks
Faz1:   metrics_raw, metrics_1m, metrics_1h, metrics_1d,
        monitors (id, type, target, expected, enabled, ...), uptime_log,
        maintenance_windows, alert_state, storage_pools (raid/zfs durumu),
        runbooks (scope_type, scope_id, markdown)
Faz2:   kiosk_tokens (token sha256, ad, bitis), network_devices (mac PK),
        proxy_hosts, certificates, ddns_records,
        apps (iki adres: url + internal_url, monitor_id→monitors,
              container_name, source manual|docker, widget_type/config),
        app_categories, bookmarks, wol_devices, speedtest_results,
        proxy_hosts, certificates, ddns_records, network_devices,
        tailscale_peers (id, name, os, ts_ip, online, last_seen, relay,
                         key_expires_at, is_exit_node, tags)
Faz3:   logs(FTS5), backup_jobs, backup_runs, vuln_scans, port_forwards,
        db_connections (ad, motor, host/port|container, db, kullanıcı,
                        parola🔒, readonly, keşif_kaynağı),
        db_saved_queries, db_query_history,
        automations, webhooks, api_tokens, host_cron_jobs, app_templates,
        repos (id, name, github_url, local_path, default_branch, last_commit,
               last_sync_at, sync_status, is_private, gitops_stack_id, sort_order)
```
Tüm kaynak ve zaman serisi tablolarında **`host_id INTEGER NOT NULL DEFAULT 1`** (T7) — istisna `settings`, orada host kapsamı `scope_type='host'` ile ifade edilir (T9).

## API (özet)
- Auth/RBAC: `/api/auth/*`, `/api/users`, `/api/roles`, `/api/audit`
- Altyapı: `/api/jobs`, `/api/jobs/:id/run`
- Ayarlar: `/api/settings` (çözümlenmiş değerler + güncelle), `/api/settings/schema`, `/api/settings/:key/reset`, `/api/settings/{export,import}` — kaynak bazlı ezme `?scope_type=container&scope_id=…` ile
- İzleme: `/api/metrics/{system,docker}`, `/api/hardware`, `/api/storage/pools`, `/api/monitors`, `/api/uptime/:t`, `/api/capacity/forecast`, `/api/runbooks/:scope/:id`
- Dışa açılma: `/metrics` (Prometheus, token korumalı), `/api/kiosk` (token'lı salt-okunur görünüm)
- **Dış API (T12):** `/api/v1/*` — Bearer token, çerezsiz, sürümlenmiş. Okuma (`system`, `hardware`, `metrics/series`, `containers`(+`/{id}`, `/logs`), `monitors`, `maintenance`, `apps`, `bookmarks`, `events`), eylem (`containers/{id}/{actions,update}`, `monitors/{id}/check`, `host/{power,compose}`, `host/services/{unit}/actions`), CRUD (`monitors`, `maintenance`, `apps`, `bookmarks` — `GET|POST` ve `GET|PATCH|DELETE /{id}`), görev durumu (`tasks/{id}`). Ayrıca `/metrics` (Prometheus) ve panel içi `/api/tokens` (+`/{id}`). Referans: `docs/API.md`, şema: `docs/openapi.yaml`
- Alarm: `/api/maintenance`, `/api/alerts/silence`, `/api/alerts/state` (eşikler ayarlardan — ayrı kural ucu yok)
- Docker: `/api/docker/:id/{action,logs(SSE),exec(WS),update,inspect}`, `/api/docker/prune`, `/api/docker/{images,volumes,networks}`, `/api/docker/graph`, `/api/stacks/*`
- Host: `/api/host/{power,service,firewall,files,cron}` (helper), `/api/backup/status`, `/api/updates/{os,images}`
- Faz2: `/api/apps` (+ `/:id`, `/:id/move`, `/:id/widget`, `/categories`, `/categories/:id`, `/categories/:id/move`, `/logo`, `/logo/:dosya`, `/discover`), `/api/bookmarks` (+ `/:id`), `/api/kiosk`, `/kiosk/:token` (oturumsuz), `/api/network` (+ `/wol`, `/speedtest`), `/api/proxy` (+ `/:id`, `/ddns`), `/api/backup/config`, `/api/proxy/*`, `/api/certs`, `/api/ddns`, `/api/network/{scan,devices}`, `/api/tailscale/{status,peers,serve}`, `/api/wol/:id`, `/api/speedtest`, `/api/backup/{export,import}`
- Faz3: `/api/events`, `/api/timeline` (audit+events+metrik birleşik), `/api/logs/search`, `/api/backup/{jobs,runs,snapshots,restore}`, `/api/automations`, `/api/webhooks`, `/api/tokens`, `/api/db/{connections,discover}`, `/api/db/:id/{tree,table,rows,structure,query,export}`, `/api/security/{scan,upnp,external}`, `/api/templates`, `/api/ha/*`, `/api/repos` (kayıtlı), `/api/repos/github` (GitHub'dan listele), `/api/repos/:id/{sync,log,readme,bundle}`

## Proje Yapısı
```
ServerPanel/
├── docker-compose.yml   # panel + vaultwarden + proxy + volume + docker.sock + host mount
│                        #   + backup mount + helper socket + tailscaled socket + env
├── Dockerfile
├── .env.example         # yalnızca dağıtım parametreleri: MASTER_KEY, HELPER_SECRET, PORT,
│                        #   MOCK_MODE, docker.sock / host mount / backup mount / repo mount
│                        #   yolları. Whitelist BURADA DEĞİL — host tarafında (T4).
│                        #   (Diğer her şey panelden ayarlanır — T9. İsteğe bağlı env değerleri
│                        #    ilk açılışta ayarları bir kez tohumlar.)
├── fixtures/            # MOCK_MODE veri kümeleri: docker, metrik, smart, ağ, restic, GitHub (T10)
├── .github/workflows/   # ci.yml (tsc --noEmit + npm test + redocly lint +
│                        #   check-openapi + next build + docker build)
├── docs/                # API.md (dış referans, curl/Prometheus/HA örnekleri) +
│                        #   openapi.yaml (serialize.ts ikizi, elle yazılır — T12)
├── scripts/             # os-updates.sh, image-updates.sh, smart.sh (host cron)
│                        #   + check-openapi.mjs (şema ↔ route ağacı karşılaştırması)
├── host-helper/         # unix socket + HMAC daemon + kurulum script'i
│                        #   (whitelist: host'ta /etc/panel-helper/allow.conf, root'a ait)
├── worker/              # arka plan job runner: metrik, rollup/budama, healthcheck,
│                        #   ağ tarama, yedekleme, CVE tarama, log toplama, repo senkron
├── src/
│   ├── middleware.ts
│   ├── settings.schema.ts   # TÜM ayarların tek kaynağı (T9)
│   ├── app/{login,page,monitoring,management,network,security,files,database,logs,backup,settings,automations,...}/…
│   │                    #   + app/api/…
│   ├── components/      # metrik/donanım/docker/terminal/stack/panel + Faz2 kart/widget/proxy
│   │                    #   + Faz3 yönetim/log/backup
│   │   └── settings/    # tip→widget render (int/enum/cron/secret/list) + grup + arama
│   └── lib/             # db, settings(çözümleme+tohumlama), crypto(AES-GCM), jobs, docker,
│                        # compose, metrics, hardware, healthcheck, alerting(dedup/flap/susturma),
│                        # notify(telegram+HA+ntfy+discord+email), proxy, netscan,
│                        # backup(restic), dbclient(pg/mysql/sqlite/redis sürücü soyutlaması),
│                        # tailscale, hostHelper, auth(rbac+audit)
└── data/                # volume: sqlite.db + migration öncesi kopyalar (en yeni 3) + logolar
                         #   + os/image/smart JSON
```

## Port Sahipliği: cgroup Yetmedi, ptrace + AppArmor Gerekti (2026-09-05)

M3.17 "bitti" diye raporlandı, sunucuda yarısı çalışmıyordu. Ekranda container
adları doğru görünüyordu — ama onlar M3.7'den beri var olan `hostPort`
eşlemesinden geliyordu; asıl yenilik olan cgroup yolu hiçbir satırda iş
görmüyordu.

### Ölçüm

Önbellekteki ilk gerçek tarama: 54 soket, sahiplik dağılımı
`{container: 41, unknown: 13}` — **`service` türü SIFIR**, 39 sokette pid
çözülememiş. Port 22 `unknown` görünüyordu.

Aynı script host ad alanında elle çalıştırıldı (57 soket):

| Bayrak | pid çözülen |
|---|---|
| bugünkü hâli | 15 |
| `--cap-add=SYS_PTRACE` | 17 |
| `--security-opt apparmor=unconfined` | 15 |
| **ikisi birlikte** | **57** |

### Kök neden

`/proc/<pid>/fd` **readdir başarılı oluyor, readlink EACCES veriyor** ve kod bu
hatayı sessizce yutuyordu (`catch { continue; }`). Yutulan hata sayısı
ölçüldüğünde ortaya çıktı: 2966 readlink hatası. Çözülebilen pid'lerin
tamamının container süreci, çözülemeyenlerin tamamının host süreci olması
sebebi işaret etti — Docker'ın varsayılan AppArmor profili `ptrace`'i "aynı
profildeki süreçler" ile sınırlıyor.

### İlk hipotez YANLIŞTI

"SYS_PTRACE eksik" denildi ve tek başına denendi: 15 → 17. Neredeyse hiçbir
şey. Hipotezi doğrulamadan düzeltmeyi göndermek, çalışmayan bir özelliği ikinci
kez "düzeltildi" diye raporlamak olurdu. Yetenek ile zorunlu erişim denetimi
(LSM) AYRI iki kapı ve ikisi de açılmadan yol açılmıyor.

### Çözüm

`ThrowawaySpec`'e `capAdd` ve `securityOpt` alanları eklendi; port taraması
ikisini de veriyor, diğer çağıranlar (yedekleme, dosya yöneticisi) vermiyor.
Genişletmenin sınırı: container kısa ömürlü, komutu sabit, zaten root ve host
ağ/PID ad alanında. Bunları verebilmek için gereken `docker.sock` erişimi
host'ta zaten root demek (T4) — yeni yetki kazanılmıyor.

### Kabul edilen sınır: socket-activation

İki bayrakla port 22 çözüldü ama sahibi `ssh.service` DEĞİL, `pid=1 systemd`.
Bu sunucuda sshd socket-activation ile çalışıyor: dinleyen soketi systemd
tutuyor, sshd'ye ancak bağlantı gelince devrediliyor. Ekranda "systemd" yazması
doğrudur, `ssh.service` yazması yanlış olurdu. Gerçek birim adı gösterebilmek
`systemctl list-sockets` gerektirir, yani T13'ün kaçındığı yeni helper eylemi —
yapılmadı. `tailscaled.service`, `beszel-agent.service` ve
`systemd-networkd.service` normal servisler olduğu için adlarıyla çıkıyor.

### Ders

Bir özelliğin "çalıştığını" ekranda dolu bir tablo görerek doğrulamak yetmiyor:
tablo, YENİ kodun değil ESKİ yolun ürettiği veriyle de dolu görünebilir. Doğru
ölçüt "kaç satır var" değil, **yeni yolun ürettiği satır sayısıydı** — ve o
sıfırdı.

---

## Doğrulama (her faz sonunda, sunucuda)
- **M0:** Panel sunucuda **HTTPS** ile açılıyor (düz HTTP'ye düşmüyor); migration çalışıyor ve öncesinde `data/backups/` altına DB kopyası düşüyor; login + RBAC + izin kontrolü + audit; Ayarlar ekranı şemadan render oluyor; **Windows'ta `MOCK_MODE=1` ile `npm run dev` aynı UI'ı sahte veriyle açıyor**; host-helper socket'i ayakta ve whitelist dışı bir komut **reddediliyor**.
- **Ayarlar (M0.5, her fazda geçerli):** Ayarlar ekranı şemadan tam render oluyor, arama çalışıyor; **metrik saklamayı 24 aydan 3 aya çek** → rollup job'ı yeniden zamanlanıyor, fazla veri budanıyor; **`backup.cron` + `backup.keep_last` değiştir** → job yeniden zamanlanıyor, fazla snapshot siliniyor; **bir container'a özel yedek sıklığı tanımla** → yalnızca o container etkileniyor, diğerleri global değerde kalıyor; "varsayılana dön" override'ı siliyor; secret ayar API'de maskeli dönüyor; her değişiklik audit'e eski→yeni değerle düşüyor.
- **Faz 1:** login+RBAC (+ hatalı parola denemesinde rate limit); job runner ekranında işler yeşil; canlı metrik + uzun dönem trend + sıcaklık + S.M.A.R.T + **RAID/ZFS havuz durumu** (varsa; degraded senaryosu simüle edilerek alarm doğrulanır); **kapasite tahmini** makul sonuç veriyor; **container'a runbook notu** eklenip alarm bildiriminde görünüyor; container durdur/başlat, log, **image/volume/network yönetimi**, **bağımlılık uyarısı**, **web terminal**, **prune**, compose up/down, tek-tık update; backup/OS/image panelleri; **reboot/systemd** helper (socket+HMAC üzerinden, audit'e düşüyor); eşik/down → **Telegram + HA + ntfy/Discord/e-posta + olay** (her kanal kendi seviye filtresine uyuyor); **bakım penceresi açıkken alarm susuyor**, flap eden servis tek bildirim üretiyor.
- **Faz 2:** kart ekle (favicon+durum), servis widget canlı verisi, label ile otomatik kart, **reverse proxy'den subdomain yayınla + HTTPS sertifikası çıkıyor + bitiş alarmı kuruluyor**, **ağ taraması cihazları buluyor ve yeni cihazda uyarı geliyor**, **Tailscale peer listesi doluyor, key expiry'si yaklaşan cihaz uyarı üretiyor, bir servis Serve ile tailnet'e yayınlanıp başka bir cihazdan açılıyor**, arama/bookmark, **ev halkı görünümü izleyici hesabıyla açılıyor ve yalnızca izin verileni gösteriyor**, **kiosk URL'i oturumsuz açılıyor ve otomatik yenileniyor**, WoL, speedtest, export/import.
- **Faz 3:** kullanıcı/rol+2FA+audit; olay merkezi + **değişiklik zaman çizelgesinde bir ayar değişikliği ile sonrasındaki olay yan yana görünüyor**; **log arama** (geçmiş sorgu + pattern alarmı); **UPnP envanteri açık yönlendirmeleri listeliyor**; **Prometheus `/metrics` token'la çekiliyor, MQTT'ye metrik düşüyor**; **yedekleme:** job kur → çalıştır → snapshot listele → **test dosyası geri yükle**; dosya yöneticisi; **veritabanı yöneticisi:** bir DB container'ı otomatik keşfediliyor, tablo listesi ve verisi görünüyor, `SELECT` çalışıyor ve CSV export ediliyor, salt-okunur bağlantıda `UPDATE` reddediliyor, yazma açıkken audit'e düşüyor, satır limiti/zaman aşımı uygulanıyor; ufw+portlar; fail2ban + **CVE taraması bulgu üretiyor** + açık port uyarısı; cron; app store kurulumu; **otomasyon:** bir kural kurulup gerçek olayla tetikleniyor, webhook dışarıdan çağrılıyor, API token'ı olmayan istek reddediliyor; Ctrl+K + widget özelleştirme.

## Dış API — `/api/v1` ve Bearer Token (2026-08-31)

Panelde 78 route handler vardı ama **hiçbiri panel dışından çağrılamıyordu**:
`guardApi` yalnızca `panel_session` çerezini tanıyor ve durum değiştiren her
istekte `x-csrf-token` başlığını çerezle karşılaştırıyor. Çerezi olmayan bir
istemci — script, Grafana, mobil uygulama, n8n — hiçbir uca erişemiyordu.

### `api_tokens` neden bir kez silinmişti, şimdi ne değişti

`019_automation` bir `api_tokens` tablosu getirmişti; `022_drop_automation` onu
kural motoruyla **birlikte** sildi. Silme gerekçesi migration yorumunda yazılı:
*"API anahtarları yalnızca Prometheus'un /metrics ucunu çekmesi içindi. Anahtar
üretecek arayüz kalmayınca o uç kullanılamaz hâle gelirdi; ikisi birlikte
gitti."*

**Eksik olan token değil, token üreten arayüzdü.** Bu iş onu getiriyor:
`/hesap` sayfasında anahtar üretme, listeleme, iptal etme ekranı
(`ApiTokenSection.tsx`). Kural motoru geri gelmiyor — tetikleyici mantığı
panelde değil, çağıran tarafta (n8n, HA) yaşıyor ve onlar zaten v1'i doğrudan
çağırabiliyor.

Bu not özellikle yazılıyor: aynı tablo ileride ikinci kez "kullanılmıyor" diye
silinebilir. Silmeden önce sorulacak soru "kim kullanıyor" değil, **"üreten
arayüz duruyor mu"**.

### Uygulama sırasında düzeltilen dört şey

**1. Hız sınırı anahtarı istemciden okunuyordu.** Plan "`X-Forwarded-For`
zincirinin son segmentine güven" diyordu. Ölçüldü ve yanlış çıktı: izole bir
örnekte her istekte farklı bir `X-Forwarded-For` gönderilerek 14 geçersiz
kimlik denemesi yapıldı → **14'ü de ayrı kovaya düştü, sınır hiç
tetiklenmedi.** Kural yalnızca önde güvenilir bir proxy olduğu BİLİNİYORSA
geçerli; panele doğrudan ulaşılabiliyorsa zincirin tamamı, sonu dâhil,
saldırgan tarafından yazılmıştır.

Yeni kural: yalnızca `X-Real-IP` — Caddyfile onu `header_up X-Real-IP
{remote_host}` ile **set ediyor** (append değil), yani istemcinin gönderdiği
değer eziliyor. Yoksa hepsi tek `"unknown"` kovasını paylaşır: sınır genelleşir
ama **yok olmaz**. Düzeltmeden sonra aynı test 11. denemede `429` verdi.

`src/lib/request.ts`'teki `clientIp()` bu iş için kullanılamadı: `X-Real-IP`
yoksa zincirin **ilk** segmentini alıyor — tam da uydurulabilir olanı. Üretimde
Caddy başlığı hep set ettiği için o yedek yol bugün hiç çalışmıyor ve audit
kayıtları doğru; ama bir hız sınırı anahtarının "bugün tetiklenmeyen" bir yedek
yola dayanması kabul edilemezdi. `apiv1/ratelimit.ts` kendi `rateLimitIp`'ini
taşıyor.

**2. `x-forwarded-proto` kontrolü geliştirmeyi tamamen kilitliyordu.**
`next dev` düz HTTP üzerinde çalışıyor ve Next başlığı kendisi `http` olarak
set ediyor; kontrol koşulsuz olduğu için her `curl` çağrısı `403` alıyordu.
Kontrol artık yalnızca üretimde çalışıyor — savunulan risk (Caddyfile'ın düz
HTTP yayınına açılması) tam olarak orada var. Kural saldırgana karşı değil,
kendi yanlış yapılandırmamıza karşı: başlığı uydurabilen saldırgan onu `https`
yazar.

**3. `Content-Type` kontrolü planda vardı, hiç uygulanmamıştı** — yanlış tip
`415` yerine `400` dönüyordu. Testte yakalandı. Kontrol `guardV1`'e değil
`readJsonBody`'ye kondu: guardV1 hangi isteğin gövde beklediğini bilmiyor,
oraya konsaydı ya gövdesiz POST'ları da reddederdi ya da tahmin yapardı.
Gövdeyi İSTEYEN fonksiyonda olması atlanmasını imkânsız kılıyor.

**4. Hız sınırı kovası geçerli tek bir istekle sıfırlanabiliyordu.**
`guardV1` başarılı bir çözümlemeden sonra `authLimiter.reset(ip)` çağırıyordu;
gerekçesi "aynı NAT arkasındaki meşru istemci başkasının denemeleri yüzünden
cezalandırılmasın" idi.

Gerekçe geçersiz çıktı. Kimlik denemesi kovası YALNIZCA başarısız yolda
(`unauthorizedAfterFailure`) okunuyor — geçerli bir anahtar ona zaten hiç
çarpmıyor. Korunacak bir şey yoktu. Sıfırlamanın tek gerçek etkisi sınırı
atlatılabilir kılmaktı: elinde tek bir geçerli anahtar olan biri, her 10
tahminin arasına bir geçerli istek sıkıştırarak sayacı sonsuza kadar
temizleyebiliyordu.

Ölçüldü: 10 geçersiz denemeden sonra 11. istek `429` aldı, ardından tek bir
geçerli istek gönderildi, sonraki tahmin yeniden `401` aldı — kova boşalmıştı.
Sıfırlama kaldırıldıktan sonra aynı sıra tekrarlandı: geçerli token kova
doluyken hâlâ `200` alıyor (yani meşru istemciyi kilitleyen bir DoS vektörü
YOK), ama tahminler pencere boyunca `429` almaya devam ediyor.

Bu, `X-Forwarded-For` ile aynı sınıftan bir kusurdu: sınır varmış gibi görünüp
hiçbir şey sınırlamayan bir kod. İkisi de ancak ÖLÇÜLEREK bulundu — ikisi de
okuyunca makul görünüyordu.

### v1'in PATCH'i panelin PATCH'inden farklı

Panelin kendi `/api/{kaynak}/{id}` uçları gövdeyi doğrudan `parseX`'e veriyor
ve o fonksiyonlar eksik alanlar için varsayılan üretiyor — yani iç "PATCH"
aslında bir PUT. Form her kaydetmede bütün alanları gönderdiği için bu bugüne
kadar sorun çıkarmadı.

Bir API istemcisi öyle davranmaz. `{"enabled": false}` gönderen bir n8n düğümü,
monitörün `intervalSeconds` ezmesini ve `expected` kuralını sessizce silerdi —
istediği tek şey bir bayrağı kapatmakken. Veri kaybı, üstelik hatasız bir `200`
ile. En sinsi hâli bakım pencerelerinde: `parseMaintenanceInput` gövdede `kind`
yoksa `"once"` varsayıyor, yani haftalık bir pencereyi kapatmak onu tek
seferliğe çevirip `weekdays` listesini silerdi.

v1'de PATCH gerçek bir birleştirme (`apiv1/crud.ts`): mevcut kaydın alanları
taban alınır, istemcinin GÖNDERDİĞİ anahtarlar üstüne yazılır, sonuç aynı
`parseX` + `validateX` ikilisinden geçer. **Doğrulama kopyalanmıyor** —
birleştirilen gövde, POST'un geçtiği kapıdan geçiyor. Ayrıştırıcılar bu yüzden
route dosyalarından alan kütüphanelerine taşındı; iki yüzeyin aynı doğrulamayı
paylaşması şart, ayrı kopyalar biri sıkılaşırken diğerini gevşek bırakırdı.

Taban yalnızca YAZILABİLİR alanları taşıyor — `status`, `lastCheckAt`,
`sortOrder` gibi türetilmiş alanlar girmiyor. Ama v1 şeklinde GÖRÜNMEYEN
alanlar (`icon`, `color`, `internalUrl`) tabana giriyor: istemci onları
göremediği için gönderemez de, tabanda olmasalardı dış bir istemcinin yaptığı
her PATCH panelden yüklenmiş logoyu ve rengi sıfırlardı.

### Repoya ilk otomatik testler

Bugüne kadar doğrulama ekran açıp bakmakla yapılıyordu ve bu yeterliydi. Bir
kimlik doğrulama yolu için değil: izin kesişimi, IP kuralı, redaction ve PATCH
birleştirmesi bozulduğunda **hiçbir ekran uyarı vermez**. Node'un yerleşik
`node:test` koşucusu kullanıldı — yeni npm bağımlılığı yok, `node:sqlite` ve
`node:crypto` tercihleriyle aynı gerekçe. 84 test, CI'da koşuyor.

Entegrasyon testi (gerçek DB + route) kapsam dışı: Next route handler'ını süreç
dışından koşturmak bir sunucu ayağa kaldırmayı gerektiriyor ve bu panelin
ölçeğinde getirisi yok. O katman izole bir örnekte elle doğrulandı.

### Bilerek dışarıda bırakılanlar

`docker.exec` ve `host.shell` — bir bearer token'a etkileşimli root kabuk
vermenin karşılığında hiçbir kazanım yok. İki katmanlı: token üretme ekranında
listelenmiyorlar, ayrıca `guardV1` bu izinleri token yolunda süzüyor.

CORS başlığı — hiçbiri gönderilmiyor. Tarayıcıdan doğrudan `fetch()`
yapabilmek, token'ı sayfanın JavaScript'ine koymak demek. Panelin kendi arayüzü
zaten çerezle ve aynı kökenden konuşuyor.

Gelen webhook — 022'de bilerek silindi, geri gelmiyor.

### Doğrulanamayan tek nokta

`Idempotency-Key`'in **HTTP düzeyindeki tekrar yolu** MOCK_MODE'da
sınanamadı: idempotency yalnızca başarılı yanıtı önbelleğe alıyor ama üç ucun
üçü de mock'ta başarıya ulaşamıyor (`update` → MOCK_MODE `503`, host uçları →
helper yok, `503`). Birim testleri `recall`/`remember`/`helperRequestId`'yi ve
geçersiz anahtarın eylemden ÖNCE kesilmesini kapsıyor; `Idempotency-Replayed:
true` başlığı ile helper tekrarının `409`'a haritalanması yalnızca tip
düzeyinde kontrol edildi. **Gerçek helper'ın kurulu olduğu sunucuda
sınanmalı** — dağıtım sonrası yapılacak iş.

---

## M2.8 Sonrası Düzeltme — İlk Gerçek Yayınlama Denemesi (2026-07-27)

Sistem testinden sonra kullanıcı Yayınlama ekranından ilk gerçek kaydını kurdu
ve tarayıcı **"DNS adresi bulunamadı"** verdi. Panel tarafı kusursuz çalışmıştı
(kayıt oluştu, `proxy.caddy` üretildi, paylaşılan volume üzerinden Caddy'ye
ulaştı, `caddy reload` başarılı oldu) ama adres açılmadı.

**Üç engel vardı, üçü de panelin dışındaydı — ama panel üçünü de biliyordu ve
hiçbirini söylemiyordu.** Teşhisi elle koymak dört ayrı komut gerektirdi.

| Engel | Durum |
|---|---|
| Yerel DNS'te kayıt yoktu (`myserver.local` vardı, alt alan adları tam eşleşmedir) | Pi-hole `pihole.toml`'a kayıt eklendi |
| Caddy 443'ü host'ta **5000**'de yayınlıyordu; portsuz adres bağlanamaz | Kullanıcı 5000'de kalmayı seçti; panel artık portu adreste gösteriyor |
| Caddy hedef container'ı **farklı Docker ağında** olduğu için adı çözemiyordu | Hedef IP:port'a çevrildi; panel artık bunu baştan uyarıyor |

Ölçüm sırasında çıkan tablo, uyarının neden gerektiğini tek başına anlatıyor:
kullanıcının **yedi container'ından beşi** Caddy ile ortak ağda değil
(`pihole_default`, `defterim_default`, `host`). Container adıyla hedef vermek
hiçbiri için çalışmazdı.

### Panelde düzeltilen üç eksik

- **Farklı ağ uyarısı yazıldı.** `caddy.ts` içindeki yorum *"ekranda uyarı
  gösteriliyor"* diyordu; **öyle bir uyarı yoktu** — kod hiç yazılmamıştı ve
  yorum yıllardır yanlış bilgi veriyordu. `ContainerSummary`'ye `networks`
  eklendi (liste API'si zaten döndürüyordu — etiketlerle aynı gerekçe) ve hedef
  seçilir seçilmez uyarı çıkıyor, çözümü de yazıyor.
- **Adres tam haliyle gösteriliyor.** Liste düz metin olarak yalnızca alan adını
  yazıyordu; Caddy 443 dışında bir porttayken kullanıcı doğal olarak portsuz
  deniyor ve bağlanamıyordu. `PANEL_HTTPS_PORT` artık panel container'ına da
  geçiliyor — daha önce yalnızca `caddy` servisinin `ports:` satırındaydı ve
  panelin bunu öğrenmesinin bir yolu yoktu.
- **"Yayını sına" düğmesi eklendi** (`/api/proxy/diagnose`): DNS → bağlantı →
  hedef sırayla denenir, ilk düşen adımda durur (ad çözülmeden bağlanmayı
  denemek aynı hatayı ikinci kez, daha anlaşılmaz kılıkta göstermek olurdu) ve
  her düşen adım **ne yapılacağını** da yazar. Üçüncü adım soruyu **Caddy'nin
  içinden** sorar.

### Teşhis aracını yazarken yapılan iki hata (ikisi de sunucuda yakalandı)

1. **Panelin DNS'i tarayıcınınki değil.** İlk sürüm yalnızca container'ın kendi
   çözümleyicisine bakıyordu; o da Docker'ın gömülü DNS'i üzerinden genel
   çözümleyicilere (1.1.1.1, 8.8.8.8) gidiyor ve `.local` gibi **yerel adları
   bilmiyor**. Sonuç: tarayıcıda gayet çalışan bir adres için "DNS bozuk" —
   düzeltmeye çalıştığımız hatanın tam tersi. Artık iki kez soruluyor (önce
   kendi çözümleyicisi, sonra LAN'ın DNS'i) ve cevabın **nereden geldiği**
   yazılıyor.
2. **Bağlantı adımı adı yeniden çözmeye çalışıyordu.** Adım 1 adresi LAN
   DNS'inden bulmuşken adım 2 container'ın çözümleyicisine gidip `ENOTFOUND`
   alıyordu. Artık adım 1'de bulunan IP'ye bağlanılıyor; SNI ve Host yine alan
   adı olarak gidiyor.

### Kabul edilen sınır: bağlantı adımı panelden sınanamıyor

Sunucuda ufw etkinken container'dan host'un yayınlanan portlarına giden paketler
düşürülür (DEPLOY.md'de yazılı, panele özgü olmayan bir Docker/ufw davranışı).
Panel bu adımı **"başarısız" değil "belirsiz"** olarak işaretliyor ve kullanıcıya
kendi bilgisayarından çalıştıracağı komutu veriyor. Ayrım korunuyor: bağlantı
**reddedildiyse** (`ECONNREFUSED`) o adreste gerçekten kimse yoktur ve bu kesin
bir hatadır; **ulaşılamıyorsa** sonuç belirsizdir ve genel sonucu düşürmez.
Sınayamadığı bir şeyi kırmızı gösteren bir teşhis aracı, kendisine olan güveni
yok eder.

**Sonuç:** `https://pihole.local:5000` → **HTTP 200**, 11 KB'lık Pi-hole giriş
sayfası. Sertifika Caddy'nin yerel CA'sından geldiği için tarayıcı uyarır —
`.local` gerçek bir alan adı olmadığından Let's Encrypt bu adres için hiçbir
zaman mümkün değildir.

---

## Container Silme Düğmesi ve compose.down İzni (2026-08-21)

Kullanıcı compose ile bir yığın kurdu, container'ı durdurdu, yığını panelden
sildi — container geride kaldı ve temizleyecek yer bulamadı. Denetim kaydı
sebebi tam olarak söylüyordu:

    appstore.remove | findarr | error
    KAYIT SİLİNDİ ama container'lar durdurulamadı: eylem izinli değil: compose.down

Üst üste binmiş iki kusur çıktı.

### 1. compose.down izin listesinde yoktu

`allowLinesFor()` onu bilerek önermiyordu; gerekçesi "panel kullanıcıya kendi
güvenlik sınırını gereğinden geniş açtırmasın" idi. Gerekçe iyiydi ama sonucu
değildi: panel "yığını kaldır" düğmesini sunuyor ve o düğme bu izin olmadan
görevini hiçbir zaman yapamıyordu. Kaydı siliyor, container'ı bırakıyordu.

Kurulum talimatının, ürünün vaat ettiği işlevi mümkün kılmaması bir
tutarsızlık. `compose.down` artık önerilen satırlar arasında. Kapsam yine dar:
desen yalnızca yığın kökü ALTINDAKİ dizinleri kabul ediyor ve o kök
`compose.up` için zaten açık olmak zorunda — yani yeni bir yüzey açılmıyor,
var olanın üstünde eksik kalan eylem tamamlanıyor.

Mevcut kurulumlarda satır elle eklenmeli:

    compose.down     ^<yigin-koku>/

ardından `sudo systemctl restart panel-helper`.

### 2. Container silinemeyen tek kaynak türüydü

`removeContainer()` iki sağlayıcıda da yazılıydı ama hiçbir API route'una
bağlı değildi — yalnızca imaj güncelleme akışı (`lib/docker/update.ts`)
kullanıyordu. Image/volume/ağ için `removeResource()` vardı ve UI'ya bağlıydı;
container'ın karşılığı yoktu. Tek çare Temizlik sekmesindeki "durmuş
container'lar" prune'uydu, ama o BÜTÜN durmuşları siler — tek bir artığı
kaldırmak için fazla geniş bir alet. Üstelik `*_panel_yedek` container'larını
da süpürür.

Yeni route: `api/docker/[id]/remove`. `[id]/action`a eklenmedi çünkü orası
`provider.action(id, action, timeout)` imzasına bağlı; aynı dosyada iki farklı
imzaya dallanmak "hangi eylem nereye gidiyor" sorusunu okunmaz yapardı.

Düğme YALNIZCA durmuş container'da görünüyor ve `force` istemciden gelmiyor.
Çalışanı silmek onu önce öldürmek demek; bu, diğer simgelerin yanında tek
tıkla durması gereken bir karar değil. Docker çalışan container'ı `force`
olmadan zaten reddediyor, o hata olduğu gibi gösteriliyor.

---

## Karşılama Sayfası — Kök Adres Herkese Açık Katalog (2026-08-21)

`e1cd72f` kart listesini giriş ekranının **altına** koymuştu. Bu tur o fikri
sonuna kadar götürüyor: kartlar giriş formunun eklentisi olmaktan çıkıp kök
adresteki karşılama sayfası oldu, giriş formu kendi sayfasına çekildi.

Gerekçe aynı: ev halkının asıl işi Jellyfin'e gitmek, panel isteyenin girdiği
yer. Kart zaten bir kısayol ve hedef servisin kendi girişi var.

### Adresleme

| Adres | Önce | Sonra |
|---|---|---|
| `/` | gösterge paneli (oturum) | karşılama (herkese açık) |
| `/panel` | — | gösterge paneli (oturum) |
| `/login` | form + kartlar | yalnızca form |

Kök adrese giden referansların tamamı dört satırdı: `nav.ts`, `help.ts`,
`LoginForm.tsx`, `login/page.tsx`.

### middleware'de kök adres tuzağı

Açık yol listesi `pathname.startsWith(`${p}/`)` ile eşleştiriyordu. Kök adres
bu listeye eklenseydi `"/docker".startsWith("/")` de true dönecek ve **panelin
tamamı oturumsuz erişime açılacaktı.**

Çözüm yoruma güvenmek değil, kalıbı yanlış kullanıma kapatmak: kök için
yalnızca `===` ile bakan ayrı bir `PUBLIC_EXACT` listesi. Doğrulaması da
ilk sıraya kondu — `/docker`, `/settings` ve `/api/apps` oturumsuz
istendiğinde sırasıyla 307/307/401 dönmeli.

### İki yol, iki SELECT

Karşılama iki farklı ziyaretçiye hizmet ediyor:

- **Anonim** → `publicAppGroups()` (değişmedi). `show_on_login = 1` işaretli
  kartlar, monitör join'i YOK, durum alanları her zaman `null`.
- **Oturumlu** → yeni `welcomeAppGroups()`. Etkin olan her kart + durum
  noktaları.

Tek işleve `withStatus` bayrağı konmadı: `e1cd72f`'nin logo route'u için
reddettiği "bazen oturum ara, bazen arama" kalıbı olurdu. İki ayrı SELECT,
"hangi sütunlar dışarı çıkıyor" sorusunu her iki yol için ayrı ayrı
sabitliyor. İkisi de aynı dar `PublicAppCard` tipini döndürüyor; `monitor_id`
SELECT'te var ama karta yazılmıyor.

Logo adresi de yola göre değişiyor — anonim `/api/login/logo`, oturumlu
`/api/apps/logo`. Karıştırmak oturumlu kullanıcıda işaretsiz kartların
logolarını 404'e düşürürdü.

### Duyuru

Yeni tablo açılmadı; iki ayar yetti. `welcome.notice` boşken şerit hiç
çizilmiyor — varsayılanın kapalı olması böyle sağlanıyor. `welcome.notice_level`
rengi seçiyor.

Anonim ziyaretçi **yalnızca** elle yazılan bu metni görüyor. `announce()`
akışının ürettiği hiçbir şey (disk doldu, container düştü, yedek başarısız)
dışarı çıkmıyor; okunmamış olay sayısı yalnızca oturum açmış ve `metrics.view`
izni olan kullanıcıya, "Panel" düğmesinin üstünde rozet olarak gösteriliyor.

### Adı değişmeyenler

`apps.login_screen` anahtarı ve `apps.show_on_login` sütunu adlarını korudu.
Yeniden adlandırmak, kullanıcının kapattığı listeyi yükseltmede sessizce
yeniden açardı — `appstore.*` anahtarları da aynı gerekçeyle bırakılmıştı.
Değişen yalnızca kullanıcıya görünen metinler ("Karşılama sayfasında göster").

### Kapsam dışı

Kiosk sayfası hâlâ `AppTile` üzerinden `/api/apps/logo`'ya gidiyor ve
oturumsuz olduğu için yüklenmiş logolarda 401 alıp baş harflere düşüyor.
`e1cd72f`'de de not edilmişti; ayrı ve küçük bir iş.

---

## Katalog Kaldırıldı · Hız Testi Yeniden · Popup Ortalama · Beni Hatırla (2026-08-16)

Dört maddelik tur. Üçü ayrı ayrı bağımsız, ilk ikisi tek ekranda buluşuyor.

### 1. Uygulama Katalogu → compose dosyası yükleme

M3.10'un şablon katalogu (9 dahili şablon + Portainer uzak kaynakları, 475
uygulamaya kadar çıkmıştı) **kaldırıldı**. Silinen dosyalar: `catalog.ts`,
`templates.ts`, `sources.ts`, `portainer.ts`, `api/appstore/sources/route.ts`
ve 860 satırlık `AppStoreScreen.tsx`. Yerine `StacksScreen.tsx` (~380 satır).

Katalog kullanılmadı; kullanıcının gerçekten yaptığı şey her seferinde kendi
compose dosyasını getirmekti. Yeni ekran bunu birinci sınıf yapıyor: dosyayı
sürükle/seç → içerik **düzenlenebilir** olarak açılıyor → kur. Yükleme
bölümü bilerek modalde değil, sayfanın kendisinde — ekranın tek işi bu.

**Boru hattı hiç değişmedi:** `yaz (wx) → compose.config → compose.up`.
Değişen tek şey girdinin nereden geldiği. Dosya **tarayıcıda** okunup metin
olarak gidiyor; multipart eklenmedi, çünkü sunucudaki yazma yolu (geçici root
container + `wx`) zaten metin bekliyordu ve içerik 256 KB ile sınırlı.

Korunanlar: ön kontrol bandı, kurulu yığın listesi, Tekrar dene/Başlat/Yeniden
başlat/Güncelle/Durdur/Kaldır, `apps.install` izni, `app_stacks` tablosu.

**Ayar anahtarları `appstore.*` olarak BIRAKILDI** (`stacks_dir`,
`file_owner`); yalnız etiketleri güncellendi. Yeniden adlandırmak, değerler
veritabanında anahtara göre durduğu için kullanıcının ayarladığı
`/home/coraspirin/docker` ve `1000:1000` değerlerini sessizce varsayılana
düşürür ve kurulumu çalışmaz hâle getirirdi. Aynı gerekçeyle migration 018/021
geri alınmadı; `appstore_sources` tablosu kullanılmadan duruyor.

Eski kayıtların şablon adı artık çözülemiyor, **ham kimlik** gösteriliyor
(`vaultwarden`, `src:2:jellyfin`): kurulu ve çalışan bir uygulamanın adını
uydurmak panelin yalan söylemesi olurdu.

### 2. Hız testi — "çok hızlı bitiyor"

Şikâyet doğruydu ve üç ayrı sebebi vardı: sabit 25 MB indiriliyordu (664
Mbit'lik hatta ≈ üçte bir saniye), TCP yavaş başlangıcı ölçüye dahildi, ve tek
akış hızlı hattı doyuramıyordu.

Yeni ölçüm: **ısınma penceresi + sabit süreli ölçüm penceresi + paralel akış**.
Pencerenin bitişi zamanlayıcıyla değil veri geldikçe hesaplanıyor; bölen de
nominal süre değil, sayımın başlangıcı ile son sayılan baytın arası.

**Gerçek uçta ölçülen üç şey tasarımı belirledi:**

| Bulgu | Karşılığı |
|---|---|
| `/__down` **istek boyutuna** bakan bir sınır uyguluyor: 10 MB ve üzeri HTTP 429 + `Retry-After ≈ 3000-3500 sn`, ceza ~1 saat; 5 MB ve altı ceza sırasında bile serbest geçiyor ve arka arkaya yüzlerce megabayt taşınabiliyor | Varsayılan parça 25 MB → **5 MB**. Sınır toplam bayta değil istek boyutuna bakıyor |
| Parçayı daha da küçültmek bedava değil: aynı hatta 5 MB → **845 Mbit**, 1 MB → **466 Mbit** (istek başına ek yük) | 5 MB tatlı nokta; 4 akış yeterli (6 akış 864, 8 akış 895 — kazanç marjinal) |
| Isınmayı yalnız süreyle kesmek gigabit hatta 2 saniyede çeyrek gigabaytı çöpe atmak, yalnız baytla kesmek 10 Mbit'lik hatta ısınmayı 10 saniyeye uzatmak demek | Isınma **hangisi önce dolarsa**: 2 sn ya da 8 MB |

Ayrıca **yön başına bayt tavanı** (varsayılan 500 MB) eklendi — kotalı
bağlantıda gigabit hattın 10 saniyede yön başına 1 GB taşıması bir maliyet.
400 Mbit'e kadar olan hatlar tavana hiç değmiyor, tam süreyi ölçüyor.

**Geliştirme sırasında yakalanan iki kendi kusurumuz:**

- **Yüklemede ısınma kilitleniyordu.** `add` yalnız pencerede başlamış istekler
  için çağrılıyordu, pencerenin açılması ise `add`in içindeydi — ısınma kendi
  kendini bekliyordu. 5 saniyelik pencere 28 saniye sürüyordu. `warm()` ayrıldı.
- **Örnek sayısını artırmak jitter'ı düzeltmedi, bozdu** (6 → 9 → 6). Dokuz
  örnekle altı turun üçünde jitter bozuldu ve tur 10 saniyeden 20 saniyeye
  çıktı: istekler ardışık ve bir öncekinin bağlantıları hâlâ kapanırken
  atılıyor. Geri alındı. Jitter'da ortalama yerine **alt ortanca** kaldı.

**Ölçülen sonuç (varsayılan ayarlarla, arka arkaya turlar):** ~10,5 sn/tur,
**813 · 841 · 826 · 815 Mbit indirme** (%3,3 sapma), yükleme 784-828 Mbit,
gecikme 29-33 ms, jitter 1-11 ms. Eski sürüm aynı hatta 664 Mbit'i saniyenin
onda birinde "ölçüyordu".

**Bilinen sınır:** turlar arka arkaya koşturulursa jitter yine bozulabiliyor
(gecikme ve hız etkilenmiyor, yalnız jitter). Tek başına koşan turda görülmedi.

Kotaya takılmak artık sessiz bir "ölçülemedi" değil: HTTP 429 yakalanıp
`Retry-After` dakikaya çevriliyor ve hangi ayarın küçültüleceği yazılıyor.
"Sunucuya ulaşılamıyor" demek yanlış teşhis olurdu — sunucuya ulaşıldı, o
reddetti.

### 3. Popup'lar sol üst köşede açılıyordu

Kök neden **Tailwind v4 preflight'ı**: `*, ::before, ::after, ::backdrop
{ margin: 0 }` kuralı, `<dialog>`u ortalayan tarayıcı kuralını (`margin: auto`)
eziyordu. `inset: 0` + `width/height: fit-content` + `margin: 0` aşırı
kısıtlanmış bir kutu demek; tarayıcı sağ/alt kenarı yok sayıyor ve kutu sol üst
köşeye yapışıyor. Tailwind **v3**'te bu kural yalnız `p`, `h1-h6` gibi sayılı
öğelere uygulanıyordu — kırılma v4'e özgü ve `Modal.tsx` v4 altında doğduğu
için **ilk günden beri** böyleydi. Son mobil commit'i bunu üretmedi; yalnız
`Modal.tsx`'in yorumuna yanlış varsayımı yazıp kalıcılaştırdı.

Yan bulgu: `max-sm:mb-0` **ölü sınıftı** (margin zaten 0), yani mobildeki
alttan açılan yaprak da hiç çalışmıyordu.

Düzeltme `globals.css`'te tek kural: `@layer base { dialog { margin: auto } }`.
Katman seçimi kasıtlı — preflight ile aynı katmanda ama daha özgül olduğu için
onu yeniyor, buna karşılık `utilities` katmanındaki `max-sm:mb-0` bunu ezmeye
devam edebiliyor. Derlenmiş CSS'te sıra doğrulandı: preflight @2847 → dialog
@6629 (base katmanının içinde) → `mt-auto` @8152 (utilities). Tek dosyalık
düzeltme **14 ekranı** birden toparlıyor. `CommandPalette` ve `AppShell`
kendi `fixed inset-0 flex` konumlandırmasını yapıyor, dokunulmadı.

### 4. Beni hatırla

`createSession()` artık `{ remember }` alıyor; ömür `security.session_ttl_hours`
(12 sa) yerine yeni `security.remember_me_days` (varsayılan **365 gün**)
üzerinden hesaplanıyor. `setSessionCookies()` değişmedi — çerez ömrünü zaten
oturum ömrüne bağlıyordu.

Bayrak 2FA'nın ikinci adımında **istemciden tekrar gönderiliyor**;
`login_challenges` tablosuna sütun eklemek migration demekti ve karşılığı yok:
bileti elinde tutan parolayı zaten doğrulamış, oturum ömrünü uzatmak yeni bir
yetki değil.

**Kayan pencere bilerek eklenmedi:** çerezin son kullanma tarihi mutlak ve
ancak bir route handler'da yazılabiliyor; her istekte tazelemek için ya
middleware'den veritabanına bakmak (Edge'de mümkün değil) ya da her sayfa
yüklemesinde fazladan bir uç çağırmak gerekirdi.

**Doğrulandı:** kutu işaretli → çerez `Expires` 2027-08-16 (1 yıl); işaretsiz
ya da alan hiç yok → 12 saat. `Secure HttpOnly SameSite=lax` korundu.

---

## Sunucu Konsolu — Hazır Kalıplar ve Serbest Komut (2026-08-07)

Kullanıcı isteği üçlüydü: sunucuya komut yazıp gönderebileceği bir konsol, bir
"güncelle" düğmesi, bir de hazır komut listesi + çalıştır düğmesi.

### Neden doğrudan yazılamadı

Bu proje **SSH kullanmıyor** ve host'ta çalışan tek şey `allow.conf`'ta yazılı
olan. Panel bir komut STRINGI göndermez; bir eylem adı gönderir, argv host
tarafında kurulur (T4, `PROTOCOL.md`). "Kullanıcının yazdığını çalıştır" bu
sözleşmede yoktu — eklemek, sözleşmenin tam olarak engellemek için var olduğu
şeyi eklemek demekti.

Çözüm ikiye bölmek oldu, çünkü istenen üç şeyin ikisi aslında serbest komut
gerektirmiyor:

- **`shell.preset`** — panel bir ANAHTAR yollar (`apt.upgrade`), argv
  `panel-helper.py`'deki `PRESETS` tablosunda sabit. Kullanıcı metni argv'ye
  hiç girmiyor; dosyanın geri kalanıyla aynı model. "Güncelle" düğmesi ve
  açılır liste bunu kullanıyor.
- **`shell.exec`** — komut metni host'ta `bash -lc`'ye geçiyor. Modelden
  bilinçli sapma, bu yüzden **ayrı** eylem ve `allow.conf`'ta **varsayılan
  kapalı**. Desenle daraltılabiliyor (`shell.exec ^apt-get `), çünkü desen
  artık komut metnine de uygulanıyor.

Ayrım şurada işe yarıyor: "paketleri güncelleyebilsin ama istediği komutu
çalıştıramasın" tek bir `allow.conf` satırıyla ifade edilebiliyor. Desensiz
açılmış bir `shell.exec`'in panele root kabuğu vermek olduğu hem install.sh
şablonunda hem PROTOCOL.md'de açıkça yazıyor.

### Panel tarafı

`host.shell` izni tek — hazır kalıp ve serbest komut için ayrı ayrı değil.
İkinci bir düğme, gerçek kararın host'ta verildiği bir yerde güvenlik
veriyormuş gibi görünürdü. Ayarlardaki yasaklı-parça listesi de aynı kategori:
kaza koruması, sınır değil (host cron'daki `hostcron.forbidden` ile aynı fikir).

"Güncelle" iki çağrı yapıyor (`apt.update` → `apt.upgrade`) ve ilki başarısızsa
duruyor: `update` çökmüşken yükseltmek eski paket listesiyle çalışmaktır. İkisini
host'ta `&&` ile birleştirmek serbest kabuk gerektirirdi.

### Zaman aşımı

Konsol eylemleri **900 sn** (diğerleri 120). 120 sn'de kesilen bir `apt-get
upgrade` dpkg'yi yarım bırakırdı. Soketin kendi zaman aşımı da büyütüldü —
15 dakika süren komuttan sonra yanıtı yazamamak, komut çalışmışken panele
"bağlantı koptu" dedirtirdi. `DEBIAN_FRONTEND=noninteractive` şart: soru soran
bir apt, cevap veremeyeceğimiz için zaman aşımına kadar bekler.

### Kabul edilen sınır

Bu bir terminal değil. Her komut ayrı çalışır (ortak kabuk oturumu yok, `cd`
sonraki komutu etkilemez), çıktı canlı akmaz — komut bitince gelir — ve `top`,
`nano` gibi etkileşimli komutlar zaman aşımına uğrar. Sebebi helper protokolünün
tek istek/tek yanıt olması; canlı akış için protokolün değişmesi gerekir.
Container'lar için gerçek terminal zaten var (`ContainerDrawer` → Terminal).

### Sunucuda yapılacak

Panel güncellemesi tek başına yetmiyor, host-helper de güncellenmeli:

    sudo host-helper/install.sh          # panel-helper.py'yi tazeler
    # /etc/panel-helper/allow.conf içinde shell.preset (ve istenirse
    # shell.exec) satırlarını aç — install.sh şablonu artık örnekleri içeriyor

Açılmadığı sürece konsol görünür ama her komuta "eylem izinli değil" der; panel
neyin eksik olduğunu söyler.

---

## host-helper Soketi: Dosya Yerine Dizin (2026-08-27)

Panelden `apt-get update` / `apt list --upgradable` çalıştırınca ham Node
hatası dönüyordu: `connect ECONNREFUSED /run/panel-helper.sock`.

### Ölçüm

| | |
|---|---|
| host soketi | inode **458364**, 26 Ağustos 06:43, `LISTEN` — sağlıklı |
| container soketi | inode **2235**, 21 Ağustos 13:39 |
| helper süreci | 26 Ağustos 06:44 başlamış, `active`/`enabled` |
| panel container | 21 Ağustos 15:42 başlamış |

### Kök neden

**Docker tek bir DOSYAYI bind-mount ederken yola değil inode'a bağlanır.**
Helper 26 Ağustos'ta yeniden başlayıp soketini silip yeniden yarattı; beş
gündür ayakta olan panel container'ı silinmiş inode'da kaldı. Dosya
container'ın gözünde duruyor ama dinleyen yok → `ECONNREFUSED`. Helper'da ya
da izin listesinde sorun yoktu — o aşamaya hiç gelinmiyordu.

Unix soketinde `ECONNREFUSED` tek bir şey demek: **dosya var, dinleyen yok.**
Dosya olmasaydı `ENOENT` gelirdi. Teşhisi tek adımda veren ayrım bu.

### Çözüm

Soket `/run/panel-helper/panel-helper.sock` oldu ve container'a **dizin**
mount ediliyor. Dizin mount'ları içeriği canlı çözdüğü için helper'ın yeniden
başlaması artık şeffaf. systemd birimine `RuntimeDirectory=panel-helper` +
**`RuntimeDirectoryPreserve=yes`** eklendi; Preserve şart, yoksa systemd dizini
servis **durunca** siler ve sorunu bir kat yukarı taşırdık.

**Yan kazanç:** `b5db2e9`'daki tuzak da kalktı. Docker bind-mount kaynağı
yokken onu dizin olarak yaratıyordu ve bu felaketti (932 restart, panel
tamamen kapalı); artık zaten dizin bekleniyor.

### İkinci kusur: panel yardım etmiyordu

`helper.ts` `ENOENT` ve `EACCES` için anlaşılır mesaj üretiyordu ama en
muhtemel arıza olan `ECONNREFUSED` için hiçbir şey yoktu — ham Node mesajı
kullanıcıya düşüyordu. Artık iki olasılığı (helper kapalı / container eski
mount'ta) ayırt ediyor ve çalıştırılacak komutu veriyor.

### Ders

Bu düzeltmeyi dağıtırken de aynı sınıf hataya düşüldü: container
`--force-recreate` edildi ama **imaj yeniden derlenmedi**, panel eski yolu
söylemeye devam etti. Doğrulama olmasa "düzeldi" denip geçilecekti.

---

## Otomasyon Kaldırıldı · Docker Derinleştirildi · Kart↔Container · Sayfa Yardımı (2026-08-03)

### Otomasyon bölümü tamamen kalktı

Kullanıcı kararı: kurallar, çalışma geçmişi **ve** API anahtarları. Sunucuda
ölçüldü — 0 kural, 0 çalışma kaydı, 0 anahtar; hiç kullanılmamış.

API anahtarları yalnızca Prometheus'un `/metrics` ucunu çekmesi içindi. Anahtar
üretecek arayüz kalmayınca o uç ölü koda dönüşürdü; ikisi birlikte gitti.
**MQTT yayını ve Home Assistant keşfi kaldı**: `state.ts` ve `publish.ts`
Prometheus'a özel değil, iki yayın yolunun ortak örnek kaynağı.

Migration **022** tabloları düşürüyor, izin/ayar/iş satırlarını temizliyor.
019 olduğu gibi duruyor — uygulanmış bir migration geriye dönük değiştirilmez,
yoksa sıfırdan kurulan panelle mevcut panel farklı şema üretir.

### Docker: eksik olan veri değil, ona giden yoldu

Kullanıcı "daha detaylı olabilir sanki" dedi. Bakınca görülen şu: detay
penceresi (sağlık, restart politikası, mount'lar, ortam değişkenleri, runbook,
ham inspect) zaten vardı — **14 pikselik bir "i" simgesinin arkasında, yedi
özdeş simgenin arasında**. Loglar ve terminal ayrı pencerelerdi ve aralarında
geçiş yoktu.

Kart görünümü bilerek yapılmadı: kartlar tablodan *daha az* bilgi gösterir.

- Üç modal tek **sekmeli çekmecede** birleşti, container **adına tıklayınca**
  açılıyor.
- Liste **compose projesine göre gruplanıyor**, arama `fold()` kullanıyor.
- **Ortam değişkenleri maskeli.** Öncesinde hepsi düz metin basılıyor, üstünde
  "parola içerebilir" uyarısı duruyordu — uyarı maskeleme değildir. Bu iş
  sırasında gerçek sunucuda Pi-hole'un `WEBPASSWORD` değeri düpedüz ekrandaydı.
  Ölçüt `isSecretName()` olarak `src/lib/text.ts`'e taşındı; `portainer.ts` ile
  aynı kural, iki kopya zamanla ayrışırdı.

### Kart ↔ container

Container adı serbest metin kutusuydu: ad ve port ezberden yazılıyor, yazım
hatası ancak kart tıklandığında ortaya çıkıyordu. Artık açılır liste ve seçince
**boş olan** ad/adres alanları yayınlanmış TCP portundan doluyor. Dolu alanlar
ezilmiyor. Adres `{host}` yer tutucusuyla kuruluyor (keşif turuyla aynı).
Docker erişilemezse liste boş gelir ve alan serbest metne düşer — kart eklemek
Docker'ın ayakta olmasına bağlı olmamalı.

### Sayfa yardımı

Başlık çubuğunda "?" düğmesi; 21 sayfa için *ne işe yarar / nasıl çalışır /
dikkat*. Tek yerde çözüldü çünkü `AppShell` zaten `usePathname()` biliyor.
Ayarların alt sayfaları metnini `settings.schema.ts`'teki grup açıklamasından
alıyor. Kaydı olmayan yolda düğme gizleniyor — boş pencere açan bir düğme bir
daha tıklanmaz.

### Doğrulama (gerçek sunucu)

```
/automation /api/automation /metrics /api/hooks/x   → 404
tablolar automations, automation_runs, api_tokens   → düşürüldü
automation.manage izni / işleri / ayarları          → 0
şema 21 → 22 · panel işleri 26 → 24
mqtt.publish işi                                    → başarılı
/ /docker /apps /appstore /proxy /jobs /users       → 200
/settings/docker                                    → 200 (yardım metni geliyor)
```

---

## Uygulama Katalogu — Kur Hatası, Uzak Kaynaklar, Özel Yığın (2026-07-30)

Kullanıcı "Kur" düğmesinden hata aldı ve Vaultwarden'ı mecburen elle kurdu.
Ardından dışarıdan kaynak ekleme ve daha geniş bir market istedi.

### Kök neden: panelde kusur yok, host reddetti

`app_stacks` kaydı: `/opt/stacks/vaultwarden` · `argüman izin verilen desene
uymuyor`. Compose dosyası yazılmış, `compose up` host-helper tarafından
reddedilmişti. **Hata metninin türü belirleyici:** helper önce eylemin izinli
olmasına, sonra argüman desenine bakıyor — desen hatası aldığımıza göre
`compose.up` izinliydi, sadece dizin tutmuyordu.

Sunucuda dört dizinle ölçüldü:

```
/home/coraspirin/docker/server-panel   → komut çalıştı  (izinli)
/home/coraspirin/docker/pihole         → komut çalıştı  (izinli)
/opt/stacks/vaultwarden                → "desene uymuyor"
/home/coraspirin/docker/yok-boyle      → "no configuration file provided"
```

Dördüncü satır ön kontrolün tasarımını verdi: izinli bir desendeki **olmayan**
bir dizin bile *komutun kendi* hatasını döndürüyor, politika reddini değil.
Helper protokolünde ayrım net — **politika reddinde `exitCode` yok, komut
çalıştıysa var**.

Panelin varsayılanı `/opt/stacks`, host-helper şablonunun önerisi ise
`^/home/KULLANICI/docker/`. İkisi hiçbir zaman eşleşemezdi. Acı taraf:
`appstore.stacks_dir` ayarının kendi yardım metni bu tuzağı zaten anlatıyordu —
panel tuzağı biliyordu ama kullanıcıyı ancak formu doldurup Kur'a bastıktan
sonra uyarıyordu.

### Ön kontrol (`preflight.ts`)

Katalog açılır açılmaz zararsız bir `compose.config` sorulup izin durumu
ölçülüyor; engelliyse **yapıştırılabilir `allow.conf` satırları** gösteriliyor.
`compose.down` o satırlara BİLEREK dahil edilmiyor — helper'ın kendi şablonu da
onu kapalı öneriyor ve kullanıcıya güvenlik sınırını gereğinden geniş açtıran
bir öneri, tavsiyenin en kötü türüdür.

"Sınanamadı" ayrı bir durum ve kırmızı değil (M2.8'de yayın teşhisinde konan
ilkenin aynısı): `compose.config` kapalıyken desen sorulamıyor ama `compose.up`
açık olabilir.

### İkinci kusur: çıkmaz

Başarısız kurulum dizini ve kaydı bırakıyor, aynı adla tekrar denemek "zaten
kurulu" diyordu. Kullanıcının elle kurmak zorunda kalmasının sebebi büyük
ihtimalle buydu. Artık başarısız kayıt ayırt ediliyor, listede **Tekrar dene**
düğmesi var ve hata metni kırpılmıyor.

### Uzak kaynaklar — Portainer type-1, compose'u panel üretir

Migration 021 (`appstore_sources`, ham belge saklanıyor). Kaynaklardan **veri**
iniyor (imaj, port, volume, env); compose YAML'ını panel üretiyor. İnternetten
inen bir dosya root yetkisiyle **çalıştırılmıyor** — catalog.ts'in gerekçesi bu
sınırın içinde korunuyor. Çok servisli (type-3) şablonlar atlanıyor ve **sayısı
ekranda yazılıyor**; sessizce yutulan bir şablon, kullanıcının katalogda olmayan
bir uygulamayı boşuna aramasıdır.

Gerçek kataloglarla sınandı ve üç şey ancak orada görüldü:

| Bulgu | Karşılığı |
|---|---|
| Portainer'ın kendi listesi **düz dizi**, `type` değeri `"container"` (metin) | Üç yazım da okunuyor; `type` yoksa alanlara bakılıyor (`repository` varsa atla, `image` varsa üret) |
| `volumes[].bind` çoğunlukla `/portainer/Files/AppData/...` | Bu bir host yolu değil, Portainer geleneği; `DATA_PATH` değişkenine bağlanıyor. Gerçek host kaynakları (`/var/run/docker.sock`) olduğu gibi geçiyor |
| `privileged`, `network_mode: host`, `docker.sock` | Otomatik uyarı üretiliyor; uyarılar kurulum modalinde değişkenlerden önce |

Uzak logolar **yüklenmiyor** (her açılışta üçüncü taraf sunuculara istek ve
internetsiz çalışamayan bir panel demekti). Zamanlanmış yenileme **yok**, elle
"Yenile" var: arka planda üçüncü taraf içerik çekmek, kullanıcının haberi
olmadan katalogun değişmesi demek; bayat katalog ise zararsız.

**Ölçülen sonuç:** iki kaynakla katalog 9 → **475 uygulama** (428 + 38 alındı,
260 atlandı).

### Kendi compose'un

Aynı boru hattı, arada bir doğrulama fazlası:
`yaz (wx) → compose.config → compose.up`. Geçersiz YAML `up`'a hiç gitmiyor ve
docker'ın kendi hata satırı gösteriliyor. Dosya diskteyse **kayıt da açılıyor** —
"listeden Tekrar dene" deyip listede öyle bir satır olmaması, panelin yapmadığı
bir şeyi vaat etmesi olurdu.

### Bilinen sınır

"Durdur" ve "Kaldır" container'ları gerçekten durduramıyor: `compose.down` izin
listesinde bilerek yok. Panel bunu o an açıkça söylüyor (kayıt siliniyor ama
"CONTAINER'LAR HÂLÂ ÇALIŞIYOR OLABİLİR" uyarısı ve elle çalıştırılacak komutla).
Ön kontrole eklenemez: sınamak için gerçekten `down` çalıştırmak gerekirdi.

### Sunucu ayarları

`appstore.stacks_dir` = `/home/coraspirin/docker` · `appstore.file_owner` =
`1000:1000` (root'un ev dizinine yazması, kullanıcının kendi compose dosyasını
SSH'tan `sudo`suz düzenleyememesi demekti).

---

## Portsuz Adresler — Panel 443'te, Yayınlar 80'de (2026-07-29)

Yukarıdaki tur `:5000` ile bitmişti ve kullanıcı adresteki portu istemedi.
"HTTPS'i tamamen bırakalım" seçeneği ölçülüp **elendi**, karma çözüme geçildi:

| | Önce | Sonra |
|---|---|---|
| Panel | `https://192.168.61.114:5000` | `https://192.168.61.114` |
| Yayın | `https://pihole.local:5000` | `http://pihole.local` |

Caddy artık 80 ve 443'ü birlikte dinliyor. Panel TLS'te kalıyor; TLS'i kapalı
yayınlar 80'de sunuluyor — yerel `.local` adresleri hem portsuz hem sertifika
uyarısız açılıyor, panel ise HTTP/2, güvenli bağlam ve `Secure` çerezini koruyor.

### Tam-http neden elendi

Ölçüldü, tercih meselesi değil: tarayıcılar şifresiz HTTP/2'yi (h2c)
**desteklemiyor**, yani HTTP/1.1'in origin başına **6 bağlantı** sınırına
düşülürdü. Panelde üç uzun ömürlü akış var (`LogViewer` ve `TerminalPane`
`EventSource`, `ImageUpdatePanel` stream) ve her biri bir bağlantıyı kalıcı
tutuyor; terminal + iki log penceresi + arka plan yoklamaları altıyı bulunca
panel **sunucuda tek bir hata satırı olmadan** donmuş görünürdü. Ayrıca
`http://192.168.61.114` güvenli bağlam değildir: `navigator.clipboard` düşer
(bir çağrı yerinde optional chaining olmadığı için TypeError) ve WebAuthn/passkey
yolu tamamen kapanırdı. Karma çözümde bunların hiçbiri olmuyor.

### Bulunan gerçek kusur

`publicUrl` **her iki şema için de** HTTPS portunu okuyordu. TLS'i kapalı bir
kayıt `http://alan.adı` olarak sunulurken ekranda `http://alan.adı:443` yazardı —
hiçbir zaman bağlanamayacak bir adresi tıklanabilir göstermek, hiç göstermemekten
kötüdür. `publishedPort` artık şemaya göre soruluyor (`PANEL_HTTP_PORT` /
`PANEL_HTTPS_PORT`). Aynı hata "Yayını sına"nın bağlantı adımında da vardı:
çalışan bir http yayınını 443'te deneyip "bağlanamadı" derdi.

`Caddyfile`'daki `auto_https disable_redirects` kaldırıldı — gerekçesi
*"80. port yayınlanmıyor"* diye yazılıydı ve o gerekçe ortadan kalktı. Artık
`http://192.168.61.114` → **308** ile https'e gidiyor.

### Yeni ayar: `proxy.default_tls`

Yeni kayıt formunun açılış değeri. Bir dağıtım parametresi değil kullanıcı
tercihi olduğu için `.env`'e değil **ayarlara** girdi (T9). Yerel ağda `.local`
yayınlayan bir kurulumda doğru varsayılan **kapalı**: Let's Encrypt o adresler
için mümkün değil, yerel CA ise her ziyarette sertifika uyarısı demek. Şema
varsayılanı `auto` bırakıldı, sunucuda `off` yapıldı.

### Doğrulama (gerçek sunucu)

```
http://pihole.local/admin/login   → 200 · 11324 bayt   (portsuz, uyarısız)
https://192.168.61.114/login      → 200 · HTTP/2       (portsuz)
http://192.168.61.114/login       → 308 → https://…
"Yayını sına"                     → 3 adım da ok
```

Not: `pihole.local` hem panel kaydı hem Pi-hole DNS kaydı olarak yeniden
oluşturuldu — ikisi de bu turdan önce silinmişti.

---

## Tüm Sistem Testi (Faz 1 + 2 + 3, 2026-07-27)

Üç fazın kapısı da kapandıktan sonra sistemin tamamı **tek turda, gerçek
sunucuda** sınandı: **60 kontrol, 0 başarısız, 1 uyarı.** Tur boyunca hiçbir
yıkıcı işlem yapılmadı (container durdurulmadı, sunucu yeniden başlatılmadı,
prune çalıştırılmadı, bildirim gönderilmedi) ve oluşturulan her kayıt aynı
turda kendi kimliğiyle silindi.

**Altyapı:** panel healthy, düz HTTP portu dışarıya kapalı, HTTPS 200, şema
**v20**, WAL, bütünlük ok, migration yedeği 3 dosyada tutuluyor.

**Kimlik ve yetki:** geçici bir izleyici hesabı kurulup üzerinde denendi —
üç yanlış parola sayaca işlendi, doğru parola girişi sayacı sıfırladı,
**12 ayrıcalıklı ucun tamamında reddedildi**, ana sayfayı sade görünümde
gördü. (Admin hesabı bilerek kilitlenme riskine sokulmadı.) Audit'te 453
kayıt ve az önceki giriş denemeleri satır satır görünüyor.

**İzleme:** gerçek CPU %12,9 / bellek %44,3 / iki disk; **katman merdiveni
çalışıyor** — 1 saat ham (720 nokta), 24 saat 1 dakikalık ortalama (1430
nokta), 30 gün 1 saatlik ortalama. 26 iş, toplam 66 bin çalışma, **0
başarısız**. 7 monitörün hepsi up. Bakım penceresi kuruldu ve silindi.

**Docker ve host:** 7 container, 13 image / 13 volume / 8 network, detay ve
canlı log akışı çalıştı. **host-helper sınırı sınandı:** `power.shutdown`
→ *"eylem izinli değil"*, izin listesindeki `service.list` ise çalıştı.

**Faz 2:** 3 uygulama kartı (Pi-hole durumu monitörden `up`), **15 ağ cihazı**
(10'unun üreticisi çözülmüş), kiosk bağlantısı kuruldu → **oturumsuz açıldı**
→ geçersiz anahtar 404 → silinince 404. **Tailscale:** soket container'a
salt-okunur bağlı ve **3 gerçek tailnet düğümünün tamamı** ağ ekranında
görünüyor.

**Faz 3:** FTS5 aramada "error" 502 / "docker" 83 eşleşme, sözdizimi bozan
sorgu motoru düşürmedi. Dosya yöneticisi `/etc/shadow`, `/proc` ve `..` ile
yol atlatma denemelerinin **üçünü de** reddetti. **37 gerçek dinleyen soket**
tarandı, 10'u container'a eşlendi. 13 gerçek cron görevi okundu. 9 şablonluk
katalog, otomasyon kuralı kur → kuru çalıştır → sil, `/metrics` anahtarsız
401 / anahtarla 27 metrik, komut paleti 17 kayıt, panel düzeni 6 widget.

**Ayarlar ve gizlilik:** cron ayarı değişince iş **anında** yeniden zamanlandı;
geçersiz cron ve tanımsız anahtar reddedildi; **6 secret'ın hiçbiri API'de düz
metin dönmedi**; ayar değişiklikleri audit'e düştü.

### Testin bulduğu tek gerçek eksik

**ufw ve fail2ban okunamıyor:** *"Host'taki helper bu eylemi tanımıyor —
panel güncellendi ama host-helper güncellenmedi."* Panel bunu ham hata yerine
anlaşılır biçimde söylüyor. Kapatmak için sunucuda **root** gerekiyor
(host-helper'ın güncellenmesi + `/etc/panel-helper/allow.conf`'a ufw ve
fail2ban satırlarının eklenmesi); komut panelde yazılı. Bu, panelin
düzeltebileceği bir kusur değil, kullanıcıya bırakılmış bir adımdır.

### Kabul edilen sınır (uyarı)

Sanal makinede S.M.A.R.T ve sıcaklık sensörü yok — donanım raporu boş.
Faz 1 kapısında zaten kabul edilmişti, kod fiziksel donanım için yazılı ve
fixture'larla sınanmış durumda.

---

## Kurulum Sırasında Senden İstenecekler

T9 sayesinde bu liste kısa: **env yalnızca dağıtım parametrelerini taşır**, geri kalan her şey panelden ayarlanır.

**Env / compose (dağıtım — panelden değiştirilemez):**
- **`MASTER_KEY`** (secret şifreleme — **panel dışında ayrı bir yerde de sakla**, T3) + **`HELPER_SECRET`** (host-helper HMAC).
- `PANEL_HTTPS_PORT` (varsayılan 8443, panelin kendisi) ve `PANEL_HTTP_PORT` (varsayılan 8080, TLS'i kapalı yayınlar + https'e yönlendirme); `docker.sock`, host mount, **yedek klasörü** ve **compose stacks dizini** yolları.

**Host tarafında, panelden bağımsız kurulur:**
- Host-helper daemon kurulumu + **`/etc/panel-helper/allow.conf` whitelist'i** (güç/systemd/ufw/cron/dosya kapsamı). Bu dosya container'a mount **edilmez** — güvenlik sınırı burasıdır (T4).

**İlk açılış sihirbazı (panelden, sonradan Ayarlar'dan değiştirilebilir):**
- İlk admin kullanıcı/parola; dil, saat dilimi, tema.
- **Telegram** token+chat_id; **Home Assistant** URL + token + `notify.mobile_app_*`.
- **Reverse proxy** sağlayıcı (NPM/Caddy/yok) + temel domain.
- **Ağ tarama aralığı** (CIDR, ör. `192.168.61.0/24`) + tarama sıklığı.
- **Tailscale:** tailnet adı + API anahtarı 🔒 (peer/key-expiry sorguları için) + `tailscaled` soketinin container'a mount edileceği yol; exit node / subnet router tercihi.
- **restic** repo hedefi (yerel/S3/rclone) + repo parolası 🔒 + yedek sıklığı ve saklanacak yedek sayısı.
- (Opsiyonel) alarm eşikleri ve sessiz saatler; Faz 2 ilk uygulama/kategori/WoL listesi; Faz 3 app-store şablonları.
