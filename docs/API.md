# Panel Dış API — `/api/v1`

Sunucu Yönetim Paneli'nin dışa açık, sürümlenmiş HTTP arayüzü. Kendi
script'lerinden, Grafana/Prometheus'tan, Home Assistant'tan ya da n8n'den
çağırmak için.

Makine okunur şema: [`openapi.yaml`](openapi.yaml).

---

## 1. Açmak

API **varsayılan olarak kapalıdır.** Kapalıyken `/api/v1` altındaki her uç ve
`/metrics` `404` döner — "kapalı" değil, "yok". Kapalı bir API'nin var olduğunu
bile söylememek gerekir.

1. **Ayarlar → API** → `api.enabled` açık.
2. **Hesabım → API Anahtarları** → *Yeni anahtar*. İzinleri seç, süre ver.
3. Değer **bir kez** gösterilir. Panel yalnızca `sha256` özetini saklıyor;
   kaybedersen kurtarma yok, yenisini üretirsin.

```
pnl_C-5iGjrGAT2LKR2eVLyWohmX88V4d1mw35dX_-i1ybQ
└──┘ └──────────────────────────────────────────┘
önek  256 bit rastgele
```

İlk 12 karakter (`pnl_` + 8) listede ve denetim kayıtlarında görünür; tek
başına kullanılamaz.

### Anahtarı kullanmak

```bash
curl -H "Authorization: Bearer pnl_..." https://sunucu/api/v1/system
```

Panelin kendi çerez oturumu da kabul edilir (elle test için `curl -b`), ama o
yolda `x-csrf-token` başlığı zorunludur. Bearer yolunda CSRF aranmaz — çerez
gönderilmediği için CSRF'nin koruduğu saldırı sınıfı yoktur.

---

## 2. Yetki modeli

Token **bir kullanıcıya bağlıdır** ve o kullanıcının izinlerinin bir **alt
kümesini** taşır. Ayrı bir kapsam (scope) sözlüğü yok: panelde zaten bir RBAC
var, ikincisini icat etmek iki yerde tutulan ve zamanla ayrışan bir yetki
tanımı üretirdi.

**Kesişim her istekte alınır.** Kullanıcının rolü daraltılırsa token da anında
daralır — token satırındaki izin listesi bir **tavan**, bir bağış değil. Bu,
oturumların `destroyAllSessionsForUser` ile çözdüğü sorunun token karşılığı;
token'ın oturumu olmadığı için kesişim çalışma zamanında yapılır.

Token yolunda ayrıca reddedilenler:

| Durum | Yanıt |
|---|---|
| `docker.exec` veya `host.shell` izni | Token'a **hiçbir koşulda** verilmez |
| Kullanıcı pasif | `401` |
| Kullanıcının parolası sıfırlanmış (`must_change_pw`) | `401` |
| Anahtar iptal edilmiş / süresi dolmuş | `401` |

Son satır önemli: parola sıfırlama çoğu zaman "bu hesap tehlikede" demektir.
Oturum tarafında kullanıcı zaten parola değiştirmeye zorlanıyor; token tarafı
aynı sonucu vermezse sıfırlama yarım kalmış olurdu.

---

## 3. Yanıt sözleşmesi

Her yanıtta `X-Panel-Api-Version: 1` ve `Cache-Control: no-store`.

**Hata gövdesi makine okunur** (iç uçlardan bilerek farklı — onlar
`{error: "metin"}` döndürüyor ve bu bir ekran için yeterli, bir script için
değil):

```json
{ "error": { "code": "forbidden", "message": "bu işlem için yetkiniz yok" } }
```

| Kod | HTTP | Ne demek |
|---|---|---|
| `unauthorized` | 401 | Geçerli anahtar yok. Sebep dışarı verilmez ("iptal edilmiş" ile "yok" ayrımı tarama yapana bilgi olurdu) |
| `forbidden` | 403 | Kimlik doğru, izin yetersiz |
| `not_found` | 404 | Kaynak yok — **ya da API kapalı** |
| `invalid_request` | 400 / 413 / 415 | Gövde, parametre veya başlık hatalı |
| `conflict` | 409 | Bu komut zaten çalıştı (bkz. Idempotency) |
| `rate_limited` | 429 | İstek sınırı; `Retry-After` başlığına bak |
| `upstream_error` | 502 | Docker / host-helper hata döndürdü |
| `internal_error` | 500 | Panel hatası |

**Mesaj insan içindir ve değişebilir. İstemci `code`'a bakar, `message`'a
değil.**

### Kararlılık sözü

- **v2 çıkana kadar `/api/v1`'de kırıcı değişiklik yapılmaz.** Kırıcı olan:
  alan kaldırmak, yeniden adlandırmak, tipini değiştirmek, zorunlu parametre
  eklemek, durum kodu değiştirmek, bir varsayılanı daraltmak.
- **Eklemeler serbest** ve her an gelebilir: yeni uç, yanıta yeni alan, yeni
  opsiyonel parametre, bir enum'a yeni değer.
- Bunun karşılığı istemciye düşen bir yükümlülüktür:
  **bilinmeyen alanları yok say, bilinmeyen enum değerlerinde çökme.**
- v2 gelirse v1 hemen kapanmaz: yanıtlar `Deprecation` ve `Sunset` (RFC 8594)
  başlıklarını taşır ve en az bir yayın hattı boyunca çalışmaya devam eder.
- `X-Panel-Api-Version` bilgi amaçlıdır, **pazarlık için değil**. Sürümleme
  yalnızca yol segmentiyle.

### CORS — bilerek yok

Hiçbir `Access-Control-Allow-Origin` başlığı gönderilmez. v1 bir
**sunucu-sunucu ve script** yüzeyi. Tarayıcıdan doğrudan `fetch()` yapabilmek,
bearer token'ı sayfanın JavaScript'ine koymak demektir — yani tarayıcı
geçmişine, eklentilere ve sayfanın çektiği her üçüncü taraf script'e açmak.

Pratik sonucu: tarayıcı preflight'ı (`OPTIONS`) başarısız olur. Bu bir hata
değil, kararın kendisi. Kendi web arayüzünü yazacaksan doğru yol token'ı kendi
sunucunda tutup paneli oradan çağırmak.

### HTTPS

Üretimde `x-forwarded-proto` başlığı varsa ve `https` değilse istek `403`
alır. Kural bir saldırgana karşı değil — başlığı uydurabilen zaten `https`
yazar — **kendi yanlış yapılandırmamıza** karşı: Caddyfile düz HTTP yayına
açılırsa token açıkta gitmeden önce istek reddedilir. `npm run dev` altında
kontrol çalışmaz (dev sunucusu düz HTTP).

---

## 4. Sınırlar

| Sınır | Ayar | Varsayılan |
|---|---|---|
| Token başına istek | `api.rate_limit_per_minute` | 120 / dk |
| IP başına **başarısız** kimlik denemesi | `api.auth_rate_limit_per_minute` | 10 / dk |
| İstek gövdesi | `api.max_body_bytes` | 65536 (64 KB) |
| Kullanıcı başına aktif anahtar | `api.max_tokens_per_user` | 20 |
| `Idempotency-Key` penceresi | `api.idempotency_window_seconds` | 300 sn |

Aşımda `429` + `Retry-After` (saniye).

Kimlik denemesi sayacı **yalnızca başarısız** çözümlemelerde artar ve
**yalnızca başarısız yolda okunur.** İki sonucu var, ikisi de bilinçli:

- **Geçerli bir anahtar bu kovadan hiç etkilenmez.** Aynı IP'yi paylaşan
  (NAT arkasındaki, ya da `X-Real-IP` göndermeyen bir kurulumda ortak
  `"unknown"` kovasına düşen) meşru istemciler, başkasının denemeleri
  yüzünden kilitlenmez. Aksi hâlde dakikada 10 uydurma anahtar göndermek
  bütün API istemcilerini durdurmaya yeterdi.
- **Başarılı bir istek sayacı sıfırlamaz.** Sıfırlasaydı, elinde tek bir
  geçerli anahtar olan biri her 10 tahminin arasına bir geçerli istek
  sıkıştırarak sınırı sonsuza kadar atlatabilirdi. Sayaç pencere dolunca
  kendiliğinden boşalır.

> ⚠️ Sayaçlar **bellek içidir** ve panel tek process olarak çalıştığı
> varsayımına dayanır. Panel yeniden başlarsa sayaçlar sıfırlanır.

**Gövde tipi zorunlu:** JSON okuyan uçlarda `Content-Type: application/json`
değilse `415`. Gövdesiz `POST` (ör. `monitors/{id}/check`) başlıksız da çalışır.

### Sayfalama

**Koleksiyon uçları `limit` alır ve tavana SESSİZCE kırpılır** — `?limit=99999`
hata değil, `200` + tavan kadar kayıt. Fazla veri istemek bir hata değil,
karşılanamayan bir istek.

| Uç | Parametre | Varsayılan | Tavan |
|---|---|---|---|
| `/events` | `limit` | 100 | 500 |
| `/containers/{id}/logs` | `tail` | 200 satır | 2000 |
| `/monitors`, `/apps`, `/bookmarks`, `/maintenance` | `limit` | 200 | 500 |

`/events` ayrıca **imleçli** (`cursor`), `offset` değil:

```bash
curl -H "Authorization: Bearer $TOKEN" \
  "https://sunucu/api/v1/events?limit=100"
# → { "items": [...], "nextCursor": "MTc4ODE3NzA5MDo0", "hasMore": true }

curl -H "Authorization: Bearer $TOKEN" \
  "https://sunucu/api/v1/events?limit=100&cursor=MTc4ODE3NzA5MDo0"
```

`events` sürekli yeni satır alan bir tablo; `offset` ile sayfa gezerken araya
yeni kayıt girdiğinde sayfa kayar ve aynı satırı iki kez görürsün ya da hiç
görmezsin. İmleç bu sınıf hatayı yapısal olarak imkânsız kılıyor.

**İmleç opaktır.** İçeriğini çözümleme, üretme, saklama biçimine güvenme —
yalnızca bir önceki yanıttan aldığın değeri geri gönder. Bozuk imleç `400`
döner; sessizce başa dönmez, çünkü hatanı gizlemek "neden hep aynı sayfayı
görüyorum" sorusunu hata ayıklanamaz hâle getirirdi.

Diğer listeler imleçsiz: ev sunucusunda monitör ve kart sayısı onlarla
ölçülür ve sıraları sabit. `hasMore: true` dönerse `limit`'i büyüt.

---

## 5. Uçlar

`GET /api/v1` kendini tanıtan bir indeks döndürür — geçerli bir anahtar ister
ama izin aramaz. Aşağıdaki liste onun okunabilir hâli.

### Okuma

| Uç | İzin |
|---|---|
| `GET /api/v1` | — (yalnızca geçerli anahtar) |
| `GET /api/v1/system` | `metrics.view` |
| `GET /api/v1/hardware` | `metrics.view` |
| `GET /api/v1/metrics/series?metrics=&range=` | `metrics.view` |
| `GET /api/v1/containers` | `docker.view` |
| `GET /api/v1/containers/{id}` | `docker.view` |
| `GET /api/v1/containers/{id}/logs?tail=&since=` | `docker.view` |
| `GET /api/v1/events?since=&until=&severity=&source=&limit=&cursor=` | `metrics.view` |
| `GET /api/v1/tasks/{id}` | eylemi başlatanla aynı |
| `GET /metrics` | `metrics.view` |

`{id}` container uçlarında **ad, tam id veya id öneki** olabilir; üçü de aynı
çalışır.

`metrics/series` metrikleri: `cpu.pct` `cpu.iowait_pct` `mem.used_pct`
`mem.used` `mem.total` `swap.used_pct` `swap.used` `load.1m` `load.5m`
`load.15m` `uptime.seconds` `disk.used_pct` `disk.used` `disk.free`
`disk.total` `net.rx_bps` `net.tx_bps` `monitor.latency` `docker.cpu_pct`
`docker.mem_used` `docker.mem_pct` `docker.restart_count` `docker.running`.
Aralıklar: `1h` `6h` `24h` `7d` `30d` `1y`.

Bilinmeyen metrik **sessizce elenmez, `400` ile reddedilir** — yazım hatası
yapan bir istemciye boş grafik gösterip sebebini gizlemek yerine. (Bu, limit
kırpmasından farklı: orada istek anlamlı ama fazla, burada istek anlamsız.)

Yanıt hangi katmanın kullanıldığını söyler (`tier`, `resolutionSeconds`) —
"bu nokta 5 saniyelik mi 1 saatlik ortalama mı" tahmin edilmesin diye.

**Loglar düz metin, akışsız.** İç uç SSE ile canlı akıyor çünkü tarayıcı bunu
gösterebiliyor; `curl` bir SSE akışına bağlanıp bekler ve `| grep` yazan
kullanıcı komut istemine hiç dönmez.

### Eylemler

| Uç | İzin | Gövde |
|---|---|---|
| `POST /api/v1/containers/{id}/actions` | `docker.action` | `{"action":"start\|stop\|restart\|pause\|unpause"}` |
| `POST /api/v1/containers/{id}/update` | `docker.action` | — → `202` + `taskId` |
| `POST /api/v1/monitors/{id}/check` | `monitors.manage` | — |
| `POST /api/v1/host/power` | `host.power` | `{"action":"reboot\|shutdown\|cancel","delayMinutes":5}` |
| `POST /api/v1/host/services/{unit}/actions` | `host.service` | `{"action":"restart\|start\|stop\|status"}` |
| `POST /api/v1/host/compose` | `host.service` | `{"action":"up\|down\|pull\|restart\|ps","dir":"/opt/stack"}` |

Host uçları host-helper'a gider. Helper kurulu değilse `503` + kurulum
talimatı döner.

**`docker.exec`, `host.shell` ve gelen webhook'lar v1'de YOK ve olmayacak.**
Bir bearer token'a etkileşimli root kabuk vermenin karşılığında hiçbir kazanım
yok. Tetikleyici mantığı da panelde değil, çağıran tarafta (n8n, HA) yaşar —
zaten v1'i doğrudan çağırabiliyorlar.

### CRUD

`monitors`, `apps`, `bookmarks`, `maintenance` için:

```
GET|POST            /api/v1/{kaynak}
GET|PATCH|DELETE    /api/v1/{kaynak}/{id}
```

| Kaynak | Okuma izni | Yazma izni |
|---|---|---|
| `monitors` | `metrics.view` | `monitors.manage` |
| `maintenance` | `metrics.view` | `monitors.manage` |
| `apps` | `panel.view` | `apps.manage` |
| `bookmarks` | `panel.view` | `apps.manage` |

- `POST` → `201` + `Location` başlığı + oluşan kaynağın tek gövdesi.
- `DELETE` → `200 {"deleted": true, "id": N}`. Silinen kaydın gövdesi
  dönmez; istemciye artık var olmayan bir şeyi işlemeye devam edebileceğini
  düşündürmemek için.
- Bozuk kimlik (`/monitors/abc`) → **`400`**, var olmayan kimlik → `404`.
  Ayrım korunur: `NaN` bir sorguya girip sessizce "kayıt yok" üretirse
  istemci kimliğinin bozuk olduğunu değil, kaydın silindiğini sanır.

#### `PATCH` gerçek bir birleştirmedir

**Gönderilmeyen alan korunur.** Yalnızca değiştirmek istediğin alanları
gönder:

```bash
# Monitörü kapat — adı, hedefi, aralık ezmesi olduğu gibi kalır
curl -X PATCH -H "Authorization: Bearer $TOKEN" \
     -H "Content-Type: application/json" \
     -d '{"enabled": false}' \
     https://sunucu/api/v1/monitors/4
```

Bir alanı **boşaltmak** için `null` gönder — JSON'da `undefined` yok,
dolayısıyla anahtarın gövdede bulunması onu kastettiğin anlamına gelir:

```json
{ "intervalSeconds": null }   // → ayardaki global değere dön
```

> Panelin **kendi** `/api/{kaynak}/{id}` ucu böyle davranmaz: orada gövde
> tam kayıt olarak yorumlanır (form her alanı gönderiyor). v1'de bu düzeltildi
> çünkü bir API istemcisi öyle davranmaz — `{"enabled": false}` göndermek bir
> monitörün ayarlarını silmemeli.

**Widget yapılandırması v1'de yok.** Panelin kart widget'ları servis parolası
taşıyor ve şifreli saklanıyor; bir bearer token'ın parola yazabildiği bir uç,
token'ın kapsamını "ayarları görüntüle"den "panelin sakladığı sırları
değiştir"e taşırdı. Kartın logosu, rengi ve panel içi adresi de v1 şeklinde
dönmez — dolayısıyla gönderilemez ve PATCH sırasında **korunur**.

---

## 6. Idempotency

Üç uç doğası gereği idempotent **değil**: `host/power`, `host/compose`,
`containers/{id}/update`. Ağ zaman aşımında istemci — n8n'in "retry on fail"
düğümü, HA'nın otomasyonu, `curl --retry` — isteği tekrarlar; ilk komut
aslında ulaşmış ve çalışmışsa ikincisi **art arda ikinci bir komut** olur.

**Çözüm: opsiyonel `Idempotency-Key` başlığı.**

```bash
KEY="gece-bakim-$(date +%F)"

curl --retry 3 --retry-connrefused --max-time 30 \
     -X POST \
     -H "Authorization: Bearer $TOKEN" \
     -H "Content-Type: application/json" \
     -H "Idempotency-Key: $KEY" \
     -d '{"action":"reboot","delayMinutes":5}' \
     https://sunucu/api/v1/host/power
```

- Aynı anahtarla pencere içinde gelen ikinci istek: helper **hiç çağrılmaz**,
  ilk yanıt tekrarlanır ve `Idempotency-Replayed: true` başlığı eklenir.
- Anahtar biçimi: en fazla **128 karakter**, yalnızca `A-Z a-z 0-9 _ . : -`.
  Dışındaki → `400`. Sınır bellek doldurmaya karşı: bu haritanın anahtarını
  istemci uyduruyor ve hız sınırı bunu tek başına kapatmaz (120 istek/dk da
  dakikada 120 yeni anahtar demek).
- Anahtarlar **kullanıcıya göre ayrılmıştır**: iki istemcinin aynı tahmin
  edilebilir adı (`"gece-bakim"`) seçmesi birbirinin yanıtını görmesine yol
  açmaz.

**Garanti panelin belleğine dayanmıyor.** host-helper zaten her isteğin
`id`'sini tutuyor ve son 5 dakikada görülmüş bir `id`'yi reddediyor. Panel
helper'a gönderdiği isteğin id'sini **anahtardan türetiyor**
(`HMAC(HELPER_SECRET, key)`), yani panel süreci yeniden başlayıp bellekteki
eşleme kaybolsa bile ikinci istek host tarafında reddedilir. O durumda uç
`409 conflict` döner ve anlamı **belirsizlik değil, kesinlik**: helper aynı
id'yi daha önce gördüyse ilk komut çalışmıştır.

> ⚠️ **Başlığı göndermezsen tekrar koruması YOKTUR.** Opt-in olmasının sebebi
> anahtarı istemcinin üretmesi gerekmesi — sunucunun uydurabileceği bir
> anahtar "aynı istek" ile "benzer istek"i ayırt edemezdi. Retry mantığını
> buna göre kur.

`containers/{id}/actions` ve `monitors/{id}/check` kapsam dışı: zaten
tekrarlanabilirler (iki kez `restart`, bir kez `restart`tan farklı bir duruma
götürmez).

---

## 7. Uzun süren işler: `container update`

İmaj güncelleme **senkron değil**. Birkaç GB'lık bir imajın çekilmesi dakikalar
sürer; senkron tutulsaydı hattaki her ara katmanın zaman aşımı devreye girerdi
— n8n ve HA'nın HTTP düğümleri onlarca saniyede keser — ve istemci işlemin
**başarısız olduğunu sanarken işlem arkada devam ederdi.** Yanlış bilgi veren
bir yanıt, geç gelen yanıttan kötüdür.

```bash
TASK=$(curl -s -X POST -H "Authorization: Bearer $TOKEN" \
  https://sunucu/api/v1/containers/nginx/update | jq -r .taskId)

# Yanıt `Retry-After: 5` taşır.
while :; do
  R=$(curl -s -H "Authorization: Bearer $TOKEN" https://sunucu/api/v1/tasks/$TASK)
  S=$(echo "$R" | jq -r .status)
  [ "$S" = "running" ] || { echo "$R"; break; }
  sleep 5
done
```

| `status` | Anlamı |
|---|---|
| `running` | Devam ediyor; `progress` alanı son satırı taşır |
| `succeeded` | Bitti; `detail` alanı ne değiştiğini yazar |
| `failed` | Hata; `error` alanı sebebi taşır |

Üst sınır **900 saniye**; aşımda görev `failed` + `upstream_error`.

Görev yalnızca **onu başlatan** token/kullanıcı tarafından okunabilir.
`taskId` tahmin edilemez olsa da yetki kontrolü tahmin edilemezliğe
bırakılmaz.

### ⚠️ `GET /api/v1/tasks/{id}` → `404` ne demek DEĞİLDİR

Görev kaydı **bellek içidir** (en fazla 100 kayıt, TTL 1 saat). Panel yeniden
başlarsa kayıt kaybolur ve bu uç `404` döner.

**`404` "işlem iptal edildi" DEMEK DEĞİLDİR.**

Zincir şöyle: panel `docker` CLI'ını bir alt süreç olarak çalıştırıyor, CLI
ise asıl işi yapmıyor — mount edilmiş sokete bağlanıp host'taki `dockerd`'ye
söylüyor. Panel container'ı yeniden başlatıldığında CLI alt süreci ölür, ama
`dockerd` panelin bir parçası değil: **imaj çekme işlemi kesilmez, devam eder
ve büyük ihtimalle tamamlanır.**

Doğru davranış: `GET /api/v1/containers/{id}` ile container'ın güncel
durumunu (`image`, `state`) kontrol et. Güncellemeyi körlemesine tekrar
tetikleme ve "başarısız" diye alarm üretme.

Aynı sebeple `status` alanında `cancelled` gibi bir değer **uydurulmaz**;
görev kaydı yoksa yanıt `404`'tür, sahte bir durum değil.

---

## 8. Prometheus

`/metrics` iki şalterin **ikisine birden** bağlıdır:

```
/metrics açık mı? = api.enabled AND integration.prometheus.enabled
/api/v1 açık mı?  = api.enabled
```

`api.enabled` kapalıyken token çözümleme yolu hiç çalışmıyor, dolayısıyla
`/metrics`'i bağımsız tutmanın iki sonucu olabilirdi: ya kimliksiz servis
edilirdi (sunucunun tüm metriklerini herkese açmak), ya da açık görünüp her
isteği `401` ile reddederdi. İkisi de yanlış.

`prometheus.yml`:

```yaml
scrape_configs:
  - job_name: sunucu-paneli
    scheme: https
    metrics_path: /metrics
    scrape_interval: 30s
    static_configs:
      - targets: ["sunucu:8443"]
    authorization:
      type: Bearer
      credentials: "pnl_BURAYA_ANAHTARI_YAZ"
    # Panel kendi ürettiği sertifikayı kullanıyorsa:
    tls_config:
      insecure_skip_verify: true
```

Anahtarı dosyaya gömmek istemiyorsan `credentials_file: /etc/prometheus/panel.token`.

Metrikler `panel_` önekli:

```
panel_cpu_usage_percent          panel_memory_used_percent      panel_load1
panel_cpu_iowait_percent         panel_memory_used_bytes        panel_load5
panel_swap_used_percent          panel_memory_total_bytes       panel_load15
panel_uptime_seconds
panel_disk_used_percent{mount="/"}          panel_disk_free_bytes{mount="/"}
panel_network_receive_bytes_per_second{device="eth0"}
panel_network_transmit_bytes_per_second{device="eth0"}
panel_monitor_up{monitor="Home Assistant",type="http"}
panel_monitor_latency_ms{monitor="Home Assistant"}
```

Container metrikleri — hepsi `{name="<container adı>"}` etiketli —
(`panel_container_running`, `panel_container_cpu_percent`,
`panel_container_memory_used_bytes`, `panel_container_restart_count`)
**varsayılan olarak kapalıdır** — `integration.prometheus.include_containers`
ile açılır. Her container için ek satır, her scrape'te ek sorgu demek.

**Etikette container ADI kullanılır, id değil.** Id her recreate'te değişir ve
Prometheus için her seferinde yepyeni bir zaman serisi demektir — birkaç
güncelleme sonra grafiklerde kopuk çizgiler ve şişmiş bir TSDB. Aynı sebeple
imaj digest'i ve log satırı gibi yüksek kardinaliteli hiçbir alan etikete
konmaz.

Exposition yalnızca **hazır kaynaklardan** beslenir (son anlık görüntü ve
rollup tabloları); ham metrik taraması yapılmaz. `node:sqlite` senkron
çalışıyor ve bir scrape'in event loop'u bloklama süresi tek haneli
milisaniyede kalmalı.

---

## 9. Home Assistant

`configuration.yaml`:

```yaml
rest_command:
  panel_container_restart:
    url: "https://sunucu:8443/api/v1/containers/{{ container }}/actions"
    method: post
    content_type: "application/json"
    headers:
      Authorization: !secret panel_api_token   # "Bearer pnl_..." biçiminde
    payload: '{"action":"restart"}'
    verify_ssl: false                          # panel kendi sertifikasını kullanıyorsa

  panel_reboot:
    url: "https://sunucu:8443/api/v1/host/power"
    method: post
    content_type: "application/json"
    headers:
      Authorization: !secret panel_api_token
      Idempotency-Key: "ha-reboot-{{ now().strftime('%Y%m%d%H%M') }}"
    payload: '{"action":"reboot","delayMinutes":2}'
    verify_ssl: false

rest:
  - resource: "https://sunucu:8443/api/v1/system"
    scan_interval: 60
    verify_ssl: false
    headers:
      Authorization: !secret panel_api_token
    sensor:
      - name: "Sunucu CPU"
        value_template: "{{ value_json.metrics.cpuPercent }}"
        unit_of_measurement: "%"
      - name: "Sunucu RAM"
        value_template: "{{ value_json.metrics.memoryUsedPercent }}"
        unit_of_measurement: "%"
```

`secrets.yaml`:

```yaml
panel_api_token: "Bearer pnl_..."
```

`Idempotency-Key`'in dakika damgası taşıması bilinçli: HA bir otomasyonu
yeniden denerse aynı dakika içindeki tekrar aynı anahtara düşer ve ikinci bir
yeniden başlatma **planlanmaz**.

---

## 10. Denetim

v1'in durum değiştiren her çağrısı denetim kaydına düşer. Token'la yapılan
işlemler `detail` alanında etiketlenir:

```
docker.restart   container  homeassistant   [token:grafana prefix:pnl_C-5iGjrG] restart
monitors.update  monitor    4               [token:n8n prefix:pnl_dzdumgF-] Test HA
```

Böylece "bu container'ı gece 3'te kim yeniden başlattı" sorusunun cevabı
"admin" değil, "admin'in grafana anahtarı" olabiliyor.

**Token'ın düz değeri hiçbir yere yazılmaz** — ne log satırına, ne hata
gövdesine, ne denetim kaydına. Denetimde yalnızca 12 karakterlik önek görünür
ve o tek başına kullanılamaz.

---

## 11. Bakım

- **Süre.** Yeni anahtarlar varsayılan 90 gün (`api.token_default_ttl_days`;
  `0` = süresiz). Süresi dolan anahtar `401` döner.
- **İptal.** Hesabım → API Anahtarları → *İptal et*. Satır **silinmez**,
  `revoked_at` işaretlenir — denetim izi kalsın diye.
- **Budama.** `api.tokens_prune` işi, iptal edilmiş veya süresi dolmuş
  satırları `api.token_retention_days` (varsayılan 180) sonra siler. `0` =
  hiç silme.
- **Son kullanım.** Anahtar listesinde `last_used_at` ve `last_used_from`
  görünür. Yazma kısılmıştır (`api.last_used_write_interval`, 60 sn) —
  15 saniyede bir scrape eden bir Prometheus günde ~5.760 gereksiz yazma
  demekti. **İstisna:** IP değişirse eşik beklenmeden yazılır; anahtarın yeni
  bir yerden kullanılmaya başlaması tam da kaçırılmaması gereken sinyal.

---

## 12. Sorun giderme

| Belirti | Sebep |
|---|---|
| Her uç `404` | `api.enabled` kapalı |
| `/metrics` `404` ama `/api/v1/system` `200` | `integration.prometheus.enabled` kapalı |
| `401`, anahtar yeni | Kullanıcının parolası sıfırlanmış (`must_change_pw`) ya da hesap pasif |
| Dün çalışan uç bugün `403` | Kullanıcının rolü daraltılmış — kesişim her istekte alınır |
| Üretimde her istek `403` | Caddyfile düz HTTP yayınına açılmış; sorun API'de değil orada |
| Tarayıcıdan `fetch()` CORS hatası | Beklenen davranış (§3) |
| `409 conflict` | Aynı `Idempotency-Key` ile gönderilen komut zaten çalıştı |
| `tasks/{id}` `404` | Panel yeniden başlamış olabilir — **iptal demek değil** (§7) |
