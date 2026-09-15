#!/usr/bin/env python3
"""host-helper (T4 / M1.13) — panelin host'ta iş yaptırdığı küçük daemon.

Panel container'ına root vermek yerine bu daemon host'ta root olarak çalışır
ve container yalnızca bir Unix soketi üzerinden **rica eder**. Ne
çalıştırılacağına host karar verir.

Neden Python: Ubuntu'da python3 her zaman var, ek paket gerekmiyor ve tüm
kod stdlib. Host'a panel için Node kurmak, azaltmaya çalıştığımız yüzeyi
büyütürdü.

## Güvenlik sınırı

İzin listesi `/etc/panel-helper/allow.conf` dosyasındadır; root'a aittir,
container'a **mount edilmez** ve env üzerinden geçirilmez. Container ele
geçirilse bile saldırgan listeyi genişletemez.

Container komut STRINGI göndermez — yalnızca bir eylem adı ve yazılı
argümanlar gönderir. Çalıştırılacak komut şablonu bu dosyada, host tarafında
sabittir. Böylece kabuk enjeksiyonu için bir yüzey kalmaz: `subprocess` shell
olmadan çağrılır.

## Kurulum

    sudo host-helper/install.sh

Ayrıntı için install.sh'ın başındaki açıklamaya bak.
"""

import hashlib
import hmac
import json
import os
import re
import socket
import socketserver
import subprocess
import sys
import syslog
import threading
import time

#: Soket bir DİZİNİN içinde duruyor, doğrudan /run altında değil.
#:
#: Docker tek bir DOSYAYI bind-mount ederken yola değil İNODE'a bağlanır.
#: Helper her yeniden başlayışında soketi silip yeniden yarattığı için,
#: dosyayı mount eden bir container o andan sonra silinmiş inode'a bakar ve
#: her istek ECONNREFUSED alır. Sunucuda tam olarak bu yaşandı: helper
#: 26 Ağustos'ta yeniden başladı, 21 Ağustos'tan beri ayakta olan panel
#: container'ı bir daha hiçbir komut çalıştıramadı.
#:
#: DİZİN mount'ları içeriği canlı çözer; soket yeniden yaratıldığında
#: container yenisini görür. Eski kurulumlar HELPER_SOCKET ile eski yolu
#: kullanmaya devam edebilir.
SOCKET_PATH = os.environ.get("HELPER_SOCKET", "/run/panel-helper/panel-helper.sock")
SECRET_PATH = os.environ.get("HELPER_SECRET_FILE", "/etc/panel-helper/secret")
ALLOW_PATH = os.environ.get("HELPER_ALLOW_FILE", "/etc/panel-helper/allow.conf")

#: İstek zaman damgası bu kadar saniye kayabilir (tekrar saldırısına karşı).
CLOCK_SKEW_SECONDS = 30
#: Görülen istek kimlikleri bu kadar süre hatırlanır.
REPLAY_WINDOW_SECONDS = 300
#: Tek bir komutun üst sınırı.
COMMAND_TIMEOUT_SECONDS = 120
#: Konsol eylemleri için üst sınır. `apt-get upgrade` uzun sürer ve 120 sn'de
#: kesilen bir paket güncellemesi dpkg'yi yarım bırakır — bu yüzden ayrı.
CONSOLE_TIMEOUT_SECONDS = 900
#: Serbest komut metninin üst sınırı: istek satırı 64 KB'de okunuyor ve
#: komutun log'a sığacak kadar kısa kalması gerekiyor.
COMMAND_MAX_LENGTH = 2000

# --------------------------------------------------------------------------
# Eylem tanımları
#
# Her eylem BURADA, host tarafında tanımlıdır. `args` sözlüğü şablona
# yerleştirilir; hiçbir değer doğrudan kabuğa geçmez.
# --------------------------------------------------------------------------


def _delay(args):
    """Gecikme dakikası. Docker'daki gibi 0 = hemen."""
    seconds = int(args.get("delaySeconds", 0))
    if seconds < 0 or seconds > 86400:
        raise ValueError("delaySeconds 0-86400 arasında olmalı")
    return str(max(0, seconds // 60))


def _unit(args):
    unit = str(args.get("unit", ""))
    # systemd birim adı: harf, rakam, nokta, tire, alt çizgi, @ ve :
    if not re.fullmatch(r"[A-Za-z0-9._@:-]{1,128}", unit):
        raise ValueError("geçersiz birim adı")
    return unit


def _journal_since(args):
    """Kaç saniye geriye bakılacak. Üst sınır bir gün: panel geçmişi bir kerede
    kopyalamaya kalkarsa hem helper hem veritabanı boğulur."""
    seconds = int(args.get("sinceSeconds", 3600))
    if seconds < 1 or seconds > 86400:
        raise ValueError("sinceSeconds 1-86400 arasında olmalı")
    return "-%ds" % seconds


def _journal_lines(args):
    lines = int(args.get("lines", 2000))
    if lines < 1 or lines > 50000:
        raise ValueError("lines 1-50000 arasında olmalı")
    return str(lines)


def _cron_user(args):
    user = str(args.get("user", "root"))
    if not re.fullmatch(r"[a-z_][a-z0-9_-]{0,31}", user):
        raise ValueError("gecersiz kullanici adi")
    return user


def _ufw_rule(args):
    """ufw kural argümanı — argv PARÇALARI olarak.

    Serbest metin KABUL EDİLMİYOR: yalnızca `port/proto` ya da
    `from <ip> to any port <n> [proto tcp|udp]` kalıpları. ufw'nin kendi söz
    dizimi çok geniş ve panelden gelen bir dizeyi olduğu gibi geçirmek, izin
    listesini anlamsızlaştırırdı.

    ⚠️ LİSTE DÖNÜYOR, DİZE DEĞİL. `subprocess.run` komutu `shell=False` ile
    çalıştırdığı için çok kelimelik bir kural tek argüman olarak geçerse ufw
    onu ayrıştıramaz ("Wrong number of arguments") — `from ... to any port ...`
    biçimi bu yüzden hiç çalışmıyordu. Bölme, kural DESENE UYDUKTAN sonra
    yapılıyor: parçaların tamamı beyaz listeden geliyor, kabuk devrede değil.
    """
    rule = str(args.get("rule", "")).strip()
    if re.fullmatch(r"\d{1,5}(/(tcp|udp))?", rule):
        return rule.split()
    if re.fullmatch(
        r"from [0-9a-fA-F:.]{3,45}(/\d{1,3})? to any port \d{1,5}( proto (tcp|udp))?", rule
    ):
        return rule.split()
    raise ValueError("gecersiz ufw kurali")


def _ufw_comment(args):
    """İsteğe bağlı kural açıklaması.

    Ayrı argüman olarak duruyor çünkü kuralın kendisi boşluktan bölünüyor;
    boşluk içeren bir açıklama o bölmede parçalanırdı. Tırnak ve kaçış
    karakteri yok — ufw'ye argv olarak gidiyor, kabuk yorumlaması yok.
    """
    text = str(args.get("comment", "")).strip()
    if not text:
        return []
    if not re.fullmatch(r"[A-Za-z0-9 ._-]{1,64}", text):
        raise ValueError("gecersiz aciklama")
    return ["comment", text]


def _ufw_policy(args):
    """`ufw default <policy> <direction>` argümanları."""
    policy = str(args.get("policy", ""))
    direction = str(args.get("direction", ""))
    if policy not in ("allow", "deny", "reject"):
        raise ValueError("gecersiz politika")
    if direction not in ("incoming", "outgoing", "routed"):
        raise ValueError("gecersiz yon")
    return [policy, direction]


def _ufw_logging(args):
    level = str(args.get("level", ""))
    if level not in ("off", "low", "medium", "high", "full"):
        raise ValueError("gecersiz log seviyesi")
    return level


def _ufw_number(args):
    number = str(args.get("number", ""))
    if not re.fullmatch(r"\d{1,4}", number):
        raise ValueError("gecersiz kural numarasi")
    return number


def _jail(args):
    jail = str(args.get("jail", ""))
    if not re.fullmatch(r"[A-Za-z0-9._-]{1,64}", jail):
        raise ValueError("gecersiz jail adi")
    return jail


def _ip(args):
    value = str(args.get("ip", ""))
    if not re.fullmatch(r"[0-9a-fA-F:.]{3,45}", value):
        raise ValueError("gecersiz IP")
    return value


def _project_dir(args):
    path = str(args.get("dir", ""))
    if not path.startswith("/") or ".." in path.split("/"):
        raise ValueError("geçersiz dizin")
    return path


# --------------------------------------------------------------------------
# Konsol — hazır kalıplar (shell.preset)
#
# Panel yalnızca bir ANAHTAR gönderir ("apt.upgrade"); çalışacak argv burada,
# host tarafında sabittir. Kullanıcının yazdığı hiçbir metin bu komutlara
# girmez, dolayısıyla kabuk enjeksiyonu yüzeyi yok — dosyanın geri kalanıyla
# aynı model.
#
# Panel tarafındaki karşılığı `src/lib/host/presets.ts`. İki taraf da aynı
# anahtarları bilmek zorunda: buraya bir kalıp eklerken oraya da ekle, yoksa
# panelde görünmez (ya da görünür ama "bilinmeyen kalıp" der).
# --------------------------------------------------------------------------

#: apt'yi etkileşimsiz çalıştırmak şart: bir yapılandırma sorusu soran
#: apt-get, cevap veremeyeceğimiz için zaman aşımına kadar bekler.
APT_OPTIONS = ["-y", "-o", "Dpkg::Options::=--force-confold"]

PRESETS = {
    "apt.update": ["/usr/bin/apt-get", "update"],
    "apt.list_upgrades": ["/usr/bin/apt", "list", "--upgradable"],
    "apt.upgrade": ["/usr/bin/apt-get"] + APT_OPTIONS + ["upgrade"],
    "apt.full_upgrade": ["/usr/bin/apt-get"] + APT_OPTIONS + ["full-upgrade"],
    "apt.autoremove": ["/usr/bin/apt-get"] + APT_OPTIONS + ["autoremove", "--purge"],
    # Çıkış kodu 1 = dosya yok = yeniden başlatma gerekmiyor. Panel bunu
    # "hata" değil "gerek yok" diye okur.
    "reboot.required": ["/bin/cat", "/var/run/reboot-required"],
    "disk.usage": ["/bin/df", "-hT", "-x", "tmpfs", "-x", "devtmpfs", "-x", "overlay"],
    "memory.usage": ["/usr/bin/free", "-h"],
    "uptime": ["/usr/bin/uptime"],
    "top.processes": ["/bin/ps", "-eo", "pid,user,pcpu,pmem,comm", "--sort=-pcpu"],
    "journal.errors": ["/usr/bin/journalctl", "-p", "err", "-n", "200", "--no-pager"],
    "docker.df": ["/usr/bin/docker", "system", "df"],
    "docker.prune": ["/usr/bin/docker", "system", "prune", "-f"],
}


def _preset(args):
    key = str(args.get("preset", ""))
    if key not in PRESETS:
        raise ValueError("bilinmeyen kalıp: %s" % key)
    return key


def _command(args):
    """Serbest kabuk komutu (shell.exec).

    Bu fonksiyon, bu dosyanın geri kalanının özenle kaçındığı şeyi yapar:
    kullanıcının yazdığı metni bir kabuğa verir. Buradaki doğrulama bir
    güvenlik sınırı DEĞİL — tek satır ve makul uzunluk zorlaması, o kadar.
    Gerçek sınır izin listesindedir:

      * `shell.exec` satırı varsayılan olarak KAPALI gelir.
      * Desensiz açılmış bir `shell.exec`, panele host'ta root kabuğu vermekle
        aynı şeydir ve o noktadan sonra izin listesinin geri kalanı anlamsızdır.
      * Desenle açılırsa (ör. `shell.exec ^apt-get `) komut METNİ desene uymak
        zorundadır.
    """
    command = str(args.get("command", "")).strip()
    if not command:
        raise ValueError("komut boş")
    if len(command) > COMMAND_MAX_LENGTH:
        raise ValueError("komut çok uzun (en fazla %d karakter)" % COMMAND_MAX_LENGTH)
    if any(char in command for char in ("\x00", "\n", "\r")):
        raise ValueError("komut tek satır olmalı")
    return command


ACTIONS = {
    "power.reboot": lambda a: ["/sbin/shutdown", "-r", "+" + _delay(a)],
    "power.shutdown": lambda a: ["/sbin/shutdown", "-h", "+" + _delay(a)],
    "power.cancel": lambda a: ["/sbin/shutdown", "-c"],
    "service.status": lambda a: [
        "/usr/bin/systemctl",
        "show",
        _unit(a),
        "--property=Id,LoadState,ActiveState,SubState,UnitFileState,Description,ExecMainStartTimestamp",
        "--no-pager",
    ],
    "service.restart": lambda a: ["/usr/bin/systemctl", "restart", _unit(a)],
    "service.start": lambda a: ["/usr/bin/systemctl", "start", _unit(a)],
    "service.stop": lambda a: ["/usr/bin/systemctl", "stop", _unit(a)],
    "service.list": lambda a: [
        "/usr/bin/systemctl",
        "list-units",
        "--type=service",
        "--all",
        "--no-legend",
        "--no-pager",
        "--plain",
    ],
    # M3.3 — merkezi log arama. SALT OKUMA: journalctl'in yazma yeteneği yok,
    # bu yüzden izin listesine eklemek host'a yeni bir yetki açmıyor. Yine de
    # varsayılan olarak KAPALI: journal, panel kullanıcılarının görmesi
    # gerekmeyen sistem ayrıntıları da taşır ve bu kararı root vermeli.
    "journal.read": lambda a: [
        "/usr/bin/journalctl",
        "--since",
        _journal_since(a),
        "--lines",
        _journal_lines(a),
        "--output",
        "json",
        "--no-pager",
    ],
    # M3.7 — güvenlik duvarı. `ufw.status` salt okuma; kural ekleme/silme
    # ayrı eylemler, çünkü izin listesinde farklı satırlar olarak açılıp
    # kapatılabilmeleri gerekiyor ("görebilsin ama değiştiremesin").
    "ufw.status": lambda a: ["/usr/sbin/ufw", "status", "numbered"],
    # `status verbose` ile `status numbered` BİRLİKTE verilemez; varsayılan
    # politikayı ve log seviyesini yalnızca verbose gösterdiği için ayrı eylem.
    # Varsayılanı "gelen: allow" olan bir güvenlik duvarı hiçbir şey korumaz —
    # kural listesine bakan biri bunu göremez.
    "ufw.status_verbose": lambda a: ["/usr/sbin/ufw", "status", "verbose"],
    "ufw.allow": lambda a: ["/usr/sbin/ufw", "allow"] + _ufw_rule(a) + _ufw_comment(a),
    "ufw.deny": lambda a: ["/usr/sbin/ufw", "deny"] + _ufw_rule(a) + _ufw_comment(a),
    "ufw.delete": lambda a: ["/usr/sbin/ufw", "--force", "delete", _ufw_number(a)],
    # M3.18 — açma/kapama ve varsayılan politika. HER BİRİ AYRI SATIR: "kural
    # ekleyebilsin ama güvenlik duvarını kapatamasın" en olağan istek ve tek
    # bir `ufw.*` izniyle bunu ifade etmek mümkün olmazdı.
    #
    # `--force` olmadan `ufw enable` SSH bağlantısını keseceği uyarısını verip
    # onay bekler ve etkileşimsiz çalışan helper'da zaman aşımına düşerdi.
    # Onay panelde alınıyor (bkz. dangerousChange).
    "ufw.enable": lambda a: ["/usr/sbin/ufw", "--force", "enable"],
    "ufw.disable": lambda a: ["/usr/sbin/ufw", "disable"],
    "ufw.default": lambda a: ["/usr/sbin/ufw", "default"] + _ufw_policy(a),
    "ufw.logging": lambda a: ["/usr/sbin/ufw", "logging", _ufw_logging(a)],
    "ufw.app_list": lambda a: ["/usr/sbin/ufw", "app", "list"],
    # M3.8 — fail2ban. Yalnızca okuma ve BAN KALDIRMA var; ban EKLEME yok:
    # paneli bir saldırı aracına çevirmenin gereği yok, fail2ban zaten kendi
    # kurallarıyla banlıyor.
    "fail2ban.status": lambda a: ["/usr/bin/fail2ban-client", "status"],
    "fail2ban.jail": lambda a: ["/usr/bin/fail2ban-client", "status", _jail(a)],
    "fail2ban.unban": lambda a: ["/usr/bin/fail2ban-client", "set", _jail(a), "unbanip", _ip(a)],
    # M3.9 — host cron. Yazma `crontab -u <user> -` ile stdin'den yapılır ve
    # bu protokolde desteklenmediği için burada YALNIZCA OKUMA var.
    "cron.list": lambda a: ["/usr/bin/crontab", "-l", "-u", _cron_user(a)],
    "cron.list_system": lambda a: ["/bin/cat", "/etc/crontab"],
    # M1.12 — compose. `docker compose` bir CLI eklentisi olduğu için Docker
    # API'sinden çağrılamaz; host'ta çalışması gerekir.
    "compose.ps": lambda a: ["/usr/bin/docker", "compose", "--project-directory", _project_dir(a), "ps", "--format", "json"],
    "compose.config": lambda a: ["/usr/bin/docker", "compose", "--project-directory", _project_dir(a), "config"],
    "compose.up": lambda a: ["/usr/bin/docker", "compose", "--project-directory", _project_dir(a), "up", "-d"],
    "compose.pull": lambda a: ["/usr/bin/docker", "compose", "--project-directory", _project_dir(a), "pull"],
    "compose.restart": lambda a: ["/usr/bin/docker", "compose", "--project-directory", _project_dir(a), "restart"],
    "compose.down": lambda a: ["/usr/bin/docker", "compose", "--project-directory", _project_dir(a), "down"],
    # Konsol — hazır kalıplar ve serbest komut. İkisi AYRI eylem, çünkü izin
    # listesinde ayrı ayrı açılabilmeleri gerekiyor: "paketleri güncelleyebilsin
    # ama istediği komutu çalıştıramasın" en olağan istek.
    "shell.preset": lambda a: PRESETS[_preset(a)],
    "shell.exec": lambda a: ["/bin/bash", "-lc", _command(a)],
    # Panelin kendisini yeniden başlatmak için bir yol YOK: helper'ı kullanarak
    # kendi container'ını yeniden yaratabilen bir panel, whitelist'i etkisiz
    # kılacak bir kaldıraç elde ederdi.
}

#: Varsayılandan uzun sürmesi normal olan eylemler.
ACTION_TIMEOUTS = {
    "shell.preset": CONSOLE_TIMEOUT_SECONDS,
    "shell.exec": CONSOLE_TIMEOUT_SECONDS,
}

#: Konsol komutları etkileşimsiz çalışmalı: soru soran bir apt-get, cevap
#: veremeyeceğimiz için zaman aşımına kadar bekler ve dpkg'yi kilitli bırakır.
CONSOLE_ENV = {"DEBIAN_FRONTEND": "noninteractive"}


def log(message):
    syslog.syslog(syslog.LOG_INFO, message)
    print(message, file=sys.stderr, flush=True)


def read_secret():
    with open(SECRET_PATH, "rb") as handle:
        return handle.read().strip()


def load_allowlist():
    """allow.conf → {eylem: derlenmiş desen ya da None}

    Satır biçimi: `eylem [argüman-deseni]`
    Desen verilirse eylemin ana argümanı (unit / dir) bu desene UYMAK
    ZORUNDADIR. Böylece "systemd'yi yönetebilir" ile "yalnızca docker.service'i
    yeniden başlatabilir" ayrı ayrı verilebilir.
    """
    allow = {}
    try:
        with open(ALLOW_PATH, "r", encoding="utf-8") as handle:
            for raw in handle:
                line = raw.split("#", 1)[0].strip()
                if not line:
                    continue
                parts = line.split(None, 1)
                action = parts[0]
                pattern = re.compile(parts[1]) if len(parts) > 1 else None
                allow[action] = pattern
    except FileNotFoundError:
        log("UYARI: %s bulunamadı — hiçbir eyleme izin verilmiyor" % ALLOW_PATH)
    return allow


def canonical(payload):
    """İmzalanan biçim: anahtarları sıralı, boşluksuz JSON.

    Panel ve helper aynı baytları üretmeli; aksi halde imza tutmaz. Sıralama
    ve ayırıcılar bu yüzden açıkça sabitlendi.
    """
    return json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")


class ReplayGuard:
    """Görülen istek kimliklerini kısa süre hatırlar."""

    def __init__(self):
        self._seen = {}
        self._lock = threading.Lock()

    def check_and_remember(self, request_id):
        now = time.time()
        with self._lock:
            for key, seen_at in list(self._seen.items()):
                if now - seen_at > REPLAY_WINDOW_SECONDS:
                    del self._seen[key]
            if request_id in self._seen:
                return False
            self._seen[request_id] = now
            return True


REPLAY = ReplayGuard()


def handle_request(message, secret, allow):
    payload = message.get("payload")
    signature = message.get("sig")

    if not isinstance(payload, dict) or not isinstance(signature, str):
        return {"ok": False, "error": "biçimsiz istek"}

    expected = hmac.new(secret, canonical(payload), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected, signature):
        log("RED: imza geçersiz")
        return {"ok": False, "error": "imza geçersiz"}

    timestamp = payload.get("ts", 0)
    if abs(time.time() - float(timestamp)) > CLOCK_SKEW_SECONDS:
        log("RED: zaman damgası penceresi dışında")
        return {"ok": False, "error": "zaman damgası penceresi dışında"}

    request_id = str(payload.get("id", ""))
    if not request_id or not REPLAY.check_and_remember(request_id):
        log("RED: tekrar edilmiş istek %s" % request_id)
        return {"ok": False, "error": "tekrar edilmiş istek"}

    action = str(payload.get("action", ""))
    args = payload.get("args") or {}
    actor = (payload.get("actor") or {}).get("username", "?")

    if action not in ACTIONS:
        log("RED: bilinmeyen eylem %s" % action)
        return {"ok": False, "error": "bilinmeyen eylem: %s" % action}

    if action not in allow:
        log("RED: izinsiz eylem %s (isteyen: %s)" % (action, actor))
        return {"ok": False, "error": "eylem izinli değil: %s" % action}

    pattern = allow[action]
    if pattern is not None:
        # Eylemin "ana argümanı": systemd birimi, compose dizini, konsol kalıbı
        # ya da serbest komut metni. Sonuncusu sayesinde `shell.exec` desenle
        # daraltılabilir — desensiz açmak root kabuğu vermektir.
        subject = str(
            args.get("unit") or args.get("dir") or args.get("preset") or args.get("command") or ""
        )
        if not pattern.search(subject):
            log("RED: argüman izin desenine uymuyor (%s: %s)" % (action, subject))
            return {"ok": False, "error": "argüman izin verilen desene uymuyor"}

    try:
        command = ACTIONS[action](args)
    except (ValueError, TypeError) as error:
        return {"ok": False, "error": "geçersiz argüman: %s" % error}

    timeout = ACTION_TIMEOUTS.get(action, COMMAND_TIMEOUT_SECONDS)
    environment = None
    if action in ACTION_TIMEOUTS:
        environment = dict(os.environ, **CONSOLE_ENV)

    log("ÇALIŞTIR: %s (isteyen: %s) → %s" % (action, actor, " ".join(command)))
    started = time.time()

    try:
        # shell=False: komut bir liste olarak veriliyor, hiçbir değer kabuk
        # tarafından yorumlanmıyor. Tek istisna `shell.exec`, ki orada kabuğu
        # çağırmak eylemin kendisi — bkz. `_command()`.
        completed = subprocess.run(
            command,
            capture_output=True,
            timeout=timeout,
            check=False,
            env=environment,
        )
    except subprocess.TimeoutExpired:
        return {"ok": False, "error": "komut %d saniyede bitmedi ve kesildi" % timeout}
    except FileNotFoundError:
        return {"ok": False, "error": "komut bulunamadı: %s" % command[0]}

    return {
        "ok": completed.returncode == 0,
        "exitCode": completed.returncode,
        "stdout": completed.stdout.decode("utf-8", "replace")[:100000],
        "stderr": completed.stderr.decode("utf-8", "replace")[:10000],
        "durationMs": int((time.time() - started) * 1000),
    }


class Handler(socketserver.StreamRequestHandler):
    # Bu zaman aşımı soketin TÜM işlemlerine uygulanır — isteği okumaya da,
    # yanıtı yazmaya da. 15 dakika süren bir `apt-get upgrade`'in ardından
    # yanıtı yazamamak, komut çalışmışken panele "bağlantı koptu" dedirtirdi.
    timeout = CONSOLE_TIMEOUT_SECONDS + 60

    def handle(self):
        try:
            line = self.rfile.readline(1024 * 64)
            if not line:
                return
            message = json.loads(line.decode("utf-8"))
        except (ValueError, UnicodeDecodeError):
            # Bytes literali ASCII dışı karakter alamaz; metin olarak kurulup
            # kodlanıyor.
            self.wfile.write(
                json.dumps({"ok": False, "error": "geçersiz JSON"}, ensure_ascii=False).encode(
                    "utf-8"
                )
                + b"\n"
            )
            return

        # İzin listesi HER İSTEKTE yeniden okunuyor: yöneticinin bir eylemi
        # kapatması için daemon'u yeniden başlatması gerekmesin. Yanlış giden
        # bir şeyi durdurmak, bir dosyayı düzenlemek kadar kolay olmalı.
        response = handle_request(message, read_secret(), load_allowlist())
        self.wfile.write((json.dumps(response, ensure_ascii=False) + "\n").encode("utf-8"))


class Server(socketserver.ThreadingUnixStreamServer):
    daemon_threads = True
    allow_reuse_address = True


def main():
    syslog.openlog("panel-helper", syslog.LOG_PID, syslog.LOG_DAEMON)

    if os.geteuid() != 0:
        log("HATA: root olarak çalışmalı")
        return 1

    try:
        read_secret()
    except OSError as error:
        log("HATA: sır dosyası okunamadı (%s): %s" % (SECRET_PATH, error))
        return 1

    # Üst dizin garanti altına alınıyor.
    #
    # systemd birimi `RuntimeDirectory=panel-helper` ile bunu zaten yaratıyor;
    # burası helper'ın systemd dışında (elle, sorun ayıklarken) çalıştırıldığı
    # hâl için. exist_ok: yarış hâlinde patlamasın.
    parent = os.path.dirname(SOCKET_PATH)
    if parent:
        try:
            os.makedirs(parent, mode=0o755, exist_ok=True)
        except OSError as error:
            log("HATA: %s dizini oluşturulamadı: %s" % (parent, error))
            return 1

    # Docker tuzağı: compose, bind-mount KAYNAĞI yokken ayağa kalkarsa o yolu
    # kendisi yaratır — dosya olarak değil, DİZİN olarak.
    #
    # Soket artık bir dizinin İÇİNDE olduğu için bu tuzağın zararı büyük
    # ölçüde kalktı: Docker'ın yaratacağı şey artık zaten beklediğimiz dizin.
    # Yine de eski kurulumdan kalmış ya da elle yaratılmış bir dizin soketin
    # kendi yolunda durabilir; o hâlde helper `os.unlink()` ile onu silemeyip
    # çökme döngüsüne girerdi (`os.path.exists()` dizin için de True döner).
    # Kendi kendini toplamak, root'u bu satırı aramaya göndermekten iyidir.
    if os.path.isdir(SOCKET_PATH) and not os.path.islink(SOCKET_PATH):
        try:
            os.rmdir(SOCKET_PATH)
            log("UYARI: %s dizin olarak duruyordu — silindi" % SOCKET_PATH)
        except OSError as error:
            log(
                "HATA: %s bir dizin ve silinemedi (%s). İçini boşaltıp "
                "`rmdir` ile kaldır." % (SOCKET_PATH, error)
            )
            return 1
    elif os.path.lexists(SOCKET_PATH):
        # lexists: bozuk sembolik bağ da silinmeli, exists() onu göremezdi.
        os.unlink(SOCKET_PATH)

    server = Server(SOCKET_PATH, Handler)

    # Soket panelin çalıştığı gruba açılır; başka kullanıcılar erişemez.
    group = os.environ.get("HELPER_SOCKET_GROUP")
    if group:
        import grp

        os.chown(SOCKET_PATH, 0, grp.getgrnam(group).gr_gid)
    os.chmod(SOCKET_PATH, 0o660)

    log("hazır: %s (izin listesi: %s)" % (SOCKET_PATH, ALLOW_PATH))
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
        if os.path.exists(SOCKET_PATH):
            os.unlink(SOCKET_PATH)
    return 0


if __name__ == "__main__":
    sys.exit(main())
