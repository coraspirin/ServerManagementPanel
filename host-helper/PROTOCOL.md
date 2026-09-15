# host-helper protokolü (T4)

Panel container'ına root vermek yerine, host'ta küçük bir daemon çalışır.
Container yalnızca **rica eder**; ne çalıştırılacağına host karar verir.

İlk implementasyon **M1.13**'te (güç + systemd). Bu belge sözleşmeyi M0.6'da
sabitler ki paneldeki çağrı tarafı şimdiden doğru yazılabilsin.

## Taşıma

Unix domain socket: `/run/panel-helper/panel-helper.sock`

Soket bir **dizinin içinde** duruyor ve container'a o DİZİN mount ediliyor.
Tek bir dosya mount edilseydi Docker yola değil inode'a bağlanırdı; helper her
yeniden başlayışında soketi yeniden yarattığı için container silinmiş inode'da
kalır ve her istek `ECONNREFUSED` alırdı (sunucuda yaşandı).
Container'a **yalnızca soket** mount edilir (`:ro` yeterli değil — soket
dosyası üzerinden iki yönlü iletişim olur; kısıtlama protokolde yapılır).

SSH kullanılmaz: anahtar yönetimi, host anahtarı doğrulaması ve kabuk
enjeksiyonu yüzeyi gereksiz risk ekler.

## Güvenlik sınırı: whitelist HOST tarafındadır

Komut listesi `/etc/panel-helper/allow.conf` dosyasındadır; root'a aittir ve
**container'a mount edilmez**, env üzerinden geçirilmez.

Aksi halde tüm model çöker: container ele geçirilirse saldırgan whitelist'i
genişletip host'ta istediğini çalıştırır.

## İstek

```json
{
  "id": "8f3a...",
  "ts": 1784995000,
  "action": "power.reboot",
  "args": { "delaySeconds": 60 },
  "actor": { "username": "admin", "userId": 1 }
}
```

İmza: `HMAC-SHA256(HELPER_SECRET, canonicalJson(request))`, `X-Signature`
başlığı yerine mesajın kendi `sig` alanında gönderilir:

```json
{ "payload": { ... }, "sig": "base64..." }
```

Doğrulama sırası (helper tarafında):
1. `sig` doğru mu (paylaşılan sır env'den — panel ve helper aynı değeri bilir)
2. `ts` şu andan ±30 sn içinde mi (tekrar saldırısına karşı)
3. `id` son 5 dakikada görülmüş mü (tekrar penceresi)
4. `action` whitelist'te mi
5. `args` o eylem için tanımlı şemaya uyuyor mu

Herhangi biri başarısızsa istek reddedilir ve **host tarafında** loglanır.

## Yanıt

```json
{ "ok": true, "exitCode": 0, "stdout": "...", "stderr": "", "durationMs": 12 }
```

Hata: `{ "ok": false, "error": "eylem izinli değil: power.shutdown" }`

## Eylemler (M1.13 kapsamı)

| Eylem | Argüman | Karşılığı |
|---|---|---|
| `power.reboot` | `delaySeconds` | `shutdown -r +N` |
| `power.shutdown` | `delaySeconds` | `shutdown -h +N` |
| `power.cancel` | — | `shutdown -c` |
| `service.status` | `unit` | `systemctl is-active/status` |
| `service.restart` | `unit` | `systemctl restart` |
| `service.list` | — | `systemctl list-units --type=service` |

`unit` argümanı whitelist'teki desenle eşleşmelidir; keyfi birim adı kabul
edilmez.

## Güvenlik duvarı eylemleri (M3.7 + M3.18)

| Eylem | Argüman | Karşılığı |
|---|---|---|
| `ufw.status` | — | `ufw status numbered` |
| `ufw.status_verbose` | — | `ufw status verbose` |
| `ufw.allow` | `rule`, `comment?` | `ufw allow <kural> [comment <metin>]` |
| `ufw.deny` | `rule`, `comment?` | `ufw deny <kural> [comment <metin>]` |
| `ufw.delete` | `number` | `ufw --force delete <n>` |
| `ufw.enable` | — | `ufw --force enable` |
| `ufw.disable` | — | `ufw disable` |
| `ufw.default` | `policy`, `direction` | `ufw default <policy> <direction>` |
| `ufw.logging` | `level` | `ufw logging <level>` |
| `ufw.app_list` | — | `ufw app list` |

Her eylem izin listesinde **ayrı satırdır**. Bunun sebebi, en olağan isteğin
"görebilsin ama değiştiremesin" ya da "kural ekleyebilsin ama güvenlik
duvarını kapatamasın" olması; tek bir `ufw.*` izniyle bu ayrım ifade
edilemezdi.

`rule` serbest metin DEĞİLDİR; yalnızca iki kalıp kabul edilir:

```
<port>[/tcp|/udp]
from <ip>[/<önek>] to any port <port> [proto tcp|udp]
```

Kural, desene uyduktan **sonra** boşluklardan bölünür ve argv parçaları olarak
verilir. Tek argüman hâlinde geçirilen çok kelimelik bir kuralı ufw
ayrıştıramaz — `shell=False` çalıştığımız için bölmeyi biz yapmak zorundayız.
`comment` ayrı argümandır: boşluk içerdiği için kuralla birlikte bölünemez.

`ufw.status verbose` ile `numbered` **birlikte verilemez** (ufw'nin kendi söz
dizimi); varsayılan politikayı ve log seviyesini yalnızca `verbose` gösterdiği
için ayrı bir eylem olarak duruyor. Varsayılanı "gelen: allow" olan bir
güvenlik duvarı hiçbir şey korumaz ve bu, kural listesine bakan birinin
göremeyeceği bir gerçektir.

`ufw.enable` `--force` ile çağrılır: onaysız `ufw enable`, SSH bağlantısını
keseceği uyarısını verip cevap bekler ve etkileşimsiz çalışan helper'da zaman
aşımına düşerdi. **Onay panelde alınır** — panel, kural listesinde SSH'ın,
kendi portunun ve Docker alt ağının bulunup bulunmadığına bakar ve eksikse
kullanıcıya neyin kesileceğini adıyla söyler.

## Konsol eylemleri

| Eylem | Argüman | Karşılığı |
|---|---|---|
| `shell.preset` | `preset` | `PRESETS[preset]` — argv host'ta sabit |
| `shell.exec` | `command` | `bash -lc <command>` |

`shell.preset` protokolün geri kalanıyla aynı modeldedir: panel bir **anahtar**
gönderir (`apt.upgrade`), çalışacak argv `panel-helper.py` içindeki `PRESETS`
tablosundadır. Kullanıcının yazdığı hiçbir metin komuta girmez.

`shell.exec` bu modelden **bilinçli bir sapmadır**: komut metni kabuğa geçer.
Bu yüzden ayrı bir eylemdir ve izin listesinde ayrı açılır. Desensiz açılmış
bir `shell.exec` satırı, panele host'ta root kabuğu vermekle aynıdır ve izin
listesinin geri kalanını etkisiz kılar — desenle daraltmak (`shell.exec
^apt-get `) tercih edilmelidir. Desen, diğer eylemlerdeki gibi ana argümana,
yani komut metnine uygulanır.

İkisinin zaman aşımı 900 sn'dir (diğer eylemler 120 sn): 120 sn'de kesilen bir
`apt-get upgrade`, dpkg'yi yarım bırakırdı.

## Audit

Panel her çağrıyı `audit_log`'a yazar (kim, ne, sonuç). Helper ayrıca kendi
tarafında bağımsız log tutar — panel ele geçirilse bile host'ta iz kalır.
