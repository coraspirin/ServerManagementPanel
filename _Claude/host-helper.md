# host-helper
Son güncelleme: 2026-10-09

## Ne
Host'ta root olarak çalışan küçük Python daemon (`host-helper/panel-helper.py`, yalnız stdlib). Panel container'ı root değil; host'ta komut gerekirse Unix soketi üzerinden helper'dan **rica eder**. Ne çalışacağına host karar verir. Protokol ayrıntısı: `host-helper/PROTOCOL.md`.

## Güvenlik modeli
- **İzin listesi** `/etc/panel-helper/allow.conf` (root'a ait; container'a mount EDİLMEZ, env ile geçmez). Kurulumda BOŞ gelir — hangi eylemin açılacağına kullanıcı karar verir. Satır = eylem adı (+ isteğe bağlı argüman deseni).
- Panel komut STRING'i göndermez: eylem adı + yazılı argümanlar. Komut şablonu helper'daki `ACTIONS` tablosunda sabit; `subprocess` kabuksuz.
- İstek HMAC imzalı (`/etc/panel-helper/secret` ↔ panelde `HELPER_SECRET`), zaman damgası ±30 sn, istek kimliği 300 sn hatırlanır (tekrar saldırısı).
- Komut zaman aşımı 120 sn; konsol eylemleri 900 sn (`apt upgrade` yarım kalmasın). Serbest komut en fazla 2000 karakter.
- Soket bir DİZİNDE: `/run/panel-helper/panel-helper.sock` (dosya mount'u inode'a bağlanıyordu, helper yeniden başlayınca panel kopuyordu — yaşandı).

## Eylemler (`ACTIONS`)
- Güç: `power.reboot`, `power.shutdown`, `power.cancel`, `reboot.required`
- Servis: `service.status|restart|start|stop|list`
- Paket: `apt.update`, `apt.list_upgrades`, `apt.upgrade`, `apt.full_upgrade`, `apt.autoremove`
- Sistem: `disk.usage`, `memory.usage`, `top.processes`
- journald: `journal.read`, `journal.errors`
- Docker: `docker.df`, `docker.prune`
- ufw: `ufw.status`, `ufw.status_verbose`, `ufw.allow`, `ufw.deny`, `ufw.delete`, `ufw.enable`, `ufw.disable`, `ufw.default`, `ufw.logging`, `ufw.app_list`
- fail2ban: `fail2ban.status`, `fail2ban.jail`, `fail2ban.unban`
- cron (okuma): `cron.list`, `cron.list_system`
- compose: `compose.ps|config|up|pull|restart|down` (dizin izin desenine uymalı)
- Konsol: `shell.preset` (anahtar → `PRESETS` tablosundaki sabit argv), `shell.exec` (serbest komut; ayrıca izin gerekir)
Argüman doğrulayıcılar dosyanın üstünde (`_unit`, `_ufw_rule`, `_project_dir`, `_preset`, `_command`…).

## Kullanan özellikler
| Özellik | Eylemler | Rehber |
|---|---|---|
| Sunucu sayfası (servis, güç, konsol, OS güncelleme) | `service.*`, `power.*`, `apt.*`, `shell.*` | `host.md` |
| Docker yığınları / uygulama kurulumu | `compose.*` | `docker.md`, `appstore.md` |
| Güvenlik duvarı | `ufw.*` | `firewall.md` |
| Loglar (journald) | `journal.*` | `logs.md` |
| fail2ban | `fail2ban.*` | `security.md` |
| Docker temizlik | `docker.df`, `docker.prune` | `docker.md` |

Host cron YAZMA'sı helper'ı kullanmaz (geçici container, `/etc/cron.d/panel-*`; bkz. `hostcron.md`).

## Panel tarafı
- `src/lib/host/helper.ts` — istemci: `callHelper` (seçili sunucu; uzakta `helper.call` ajan op'u, `remoteHelperAllowed(action)` ile süzülür), `callLocalHelper`, `helperConfigured()`, `parseUnitList`/`parseShow`.
- `src/lib/host/presets.ts` — preset ANAHTAR + etiketleri (komut değil). Yeni preset = burada etiket + `panel-helper.py` `PRESETS`'te argv.
- `docker-compose.yml` — `/run/panel-helper:/run/panel-helper` mount'u + `HELPER_SECRET` env.
- Eski helper'da olmayan eylem → panel "helper eski / izinli değil" mesajı verir (ör. `fail2ban.helperOutdated`); `allow.conf`'a eklenecek satır ekranda gösterilir.

## Kurulum
`sudo host-helper/install.sh` (host'ta): helper'ı `/usr/local/lib/panel-helper/`'a kopyalar, secret üretir (0600), boş `allow.conf` oluşturur, systemd birimini kurar, `.env`'e yazılacak `HELPER_SECRET`'ı basar. Uzak sunucuda da aynı kurulum + ajanın `.env`'inde `HELPER_SECRET` gerekir.

## Yeni eylem eklerken
1. `panel-helper.py`: `ACTIONS`'a argv kurucu + argüman doğrulayıcı (kabuk yok, katı desen).
2. Panelde çağrı (`src/lib/host/helper.ts` üzerinden) + gerekiyorsa uzak için `onHost`/`helper.call`.
3. Kullanıcının sunucusunda `allow.conf`'a satır ekle ve helper'ı yeniden kur/başlat (`install.sh` dosyayı kopyalar).
4. `PROTOCOL.md` ve bu dosyayı güncelle.
