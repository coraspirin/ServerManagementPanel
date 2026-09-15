#!/usr/bin/env bash
#
# host-helper kurulumu (T4 / M1.13).
#
# HOST'ta root olarak çalıştırılır:
#     sudo host-helper/install.sh
#
# Ne yapar:
#   1. panel-helper.py'yi /usr/local/lib/panel-helper/ altına kopyalar
#   2. /etc/panel-helper/secret üretir (rastgele, 0600, yalnızca root)
#   3. /etc/panel-helper/allow.conf oluşturur — VARSAYILAN OLARAK BOŞ
#   4. systemd birimini kurup başlatır
#   5. Panelin .env dosyasına yazılacak HELPER_SECRET değerini yazdırır
#
# ÖNEMLİ — izin listesi kasten BOŞ gelir. Kurulum, panele hiçbir yetki
# vermez; hangi eylemin açılacağına sen karar verirsin. "Kurdum, her şey
# açık" olan bir güvenlik bileşeni, güvenlik bileşeni değildir.
#
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "Bu script root olarak çalışmalı: sudo $0" >&2
  exit 1
fi

SOURCE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LIB_DIR=/usr/local/lib/panel-helper
CONF_DIR=/etc/panel-helper
SOCKET_GROUP="${SOCKET_GROUP:-docker}"

echo "→ helper kopyalanıyor"
install -d -m 755 "$LIB_DIR"
install -m 750 "$SOURCE_DIR/panel-helper.py" "$LIB_DIR/panel-helper.py"

echo "→ yapılandırma dizini"
install -d -m 700 "$CONF_DIR"

if [ ! -f "$CONF_DIR/secret" ]; then
  echo "→ paylaşılan sır üretiliyor"
  head -c 32 /dev/urandom | base64 | tr -d '\n' > "$CONF_DIR/secret"
  chmod 600 "$CONF_DIR/secret"
else
  echo "→ mevcut sır korunuyor"
fi

if [ ! -f "$CONF_DIR/allow.conf" ]; then
  echo "→ izin listesi oluşturuluyor (BOŞ)"
  cat > "$CONF_DIR/allow.conf" <<'CONF'
# host-helper izin listesi.
#
# Bu dosya HOST'a aittir; panel container'ı ne okuyabilir ne değiştirebilir.
# Container ele geçirilse bile buradaki satırların dışına çıkamaz.
#
# Biçim:  <eylem> [argüman-deseni]
#
# Argüman deseni verilirse, eylemin ana argümanı (systemd birimi ya da compose
# dizini) bu düzenli ifadeye UYMAK ZORUNDADIR. Böylece "systemd'yi yönetebilir"
# yerine "yalnızca şu birimi yeniden başlatabilir" denebilir.
#
# Hiçbir satır açık değilken panel host'ta hiçbir şey yapamaz. İhtiyacın olan
# satırın başındaki # işaretini kaldır ve `systemctl restart panel-helper`
# çalıştır (izin listesi her istekte yeniden okunur, yeniden başlatma bile
# gerekmez).

# --- Güç ---
# Yeniden başlatma ve kapatma. Kapatmayı açmadan önce iki kez düşün: uzaktaki
# bir sunucuyu kapatmak, fiziksel erişim olmadan geri getirilemez.
#power.reboot
#power.shutdown
#power.cancel

# --- systemd ---
# Yalnızca durum okumak en güvenlisi:
#service.status
#service.list
# Belirli birimleri yeniden başlatmak (desen ŞART — desensiz satır her birimi açar):
#service.restart ^(docker|ssh|cron)\.service$

# --- Docker compose (M1.12) ---
# Compose dizinlerini tek tek yaz; üst dizin vermek altındaki her şeyi açar.
#compose.ps ^/home/KULLANICI/docker/
#compose.config ^/home/KULLANICI/docker/
#compose.pull ^/home/KULLANICI/docker/
#compose.up ^/home/KULLANICI/docker/
#compose.restart ^/home/KULLANICI/docker/
# compose.down bir yığını tamamen durdurur — kapalı bırakmak yeğdir.
#compose.down ^/home/KULLANICI/docker/

# --- Güvenlik duvarı (M3.7 + M3.18) ---
# Her eylem ayrı satır: "görebilsin ama değiştiremesin" ve "kural ekleyebilsin
# ama duvarı kapatamasın" ancak böyle ifade edilir.
#
# Yalnızca okuma (Güvenlik Duvarı ekranı bu ikisiyle çalışır, kural yazamaz):
#ufw.status
#ufw.status_verbose
#ufw.app_list
# Kural ekleme/silme — kural söz dizimi helper tarafında doğrulanır, serbest
# metin kabul edilmez:
#ufw.allow
#ufw.deny
#ufw.delete
# DİKKAT: ufw.enable, kural listesi eksik bir sunucuda SSH dahil her şeyi
# keser. Panel önce uyarır ama son sözü izin listesi söyler.
#ufw.enable
#ufw.disable
#ufw.default
#ufw.logging

# --- Sunucu konsolu: hazır kalıplar ---
# Çalışacak komutlar host tarafında (panel-helper.py içindeki PRESETS) sabittir;
# panel yalnızca bir anahtar gönderir. Desen o anahtara uygulanır.
#
# Yalnızca okuyanlar (disk, bellek, süreç, uptime, güncelleme listesi):
#shell.preset ^(disk|memory|uptime|top|journal|docker\.df|reboot\.required|apt\.list_upgrades)
# Paket güncellemesi de dahil her kalıp:
#shell.preset ^(apt|disk|memory|uptime|top|journal|docker|reboot)\.
# Tek tek: sadece paket listesi + güncelleme
#shell.preset ^apt\.(update|upgrade|list_upgrades)$

# --- Sunucu konsolu: SERBEST KOMUT ---
# DİKKAT. Bu satırı DESENSİZ açmak, panele host'ta root kabuğu vermektir ve
# yukarıdaki bütün desenleri anlamsız kılar (panel `shell.exec` ile zaten
# istediğini çalıştırabilir). Panel ele geçirilirse host da gitmiş olur.
#
# Gerçekten gerekiyorsa daraltarak aç — desen komut METNİNE uygulanır:
#shell.exec ^(apt-get|apt|systemctl status|docker ps)
#
# Sınırsız hâli (bilinçli bir karar olmalı):
#shell.exec
CONF
  chmod 600 "$CONF_DIR/allow.conf"
  ALLOW_IS_NEW=1
else
  echo "→ mevcut izin listesi korunuyor"
  ALLOW_IS_NEW=0
fi

echo "→ systemd birimi"
cat > /etc/systemd/system/panel-helper.service <<UNIT
[Unit]
Description=Sunucu paneli host-helper (T4)
After=network.target docker.service

[Service]
Type=simple
ExecStart=/usr/bin/python3 $LIB_DIR/panel-helper.py
Environment=HELPER_SOCKET_GROUP=$SOCKET_GROUP
Restart=always
RestartSec=3

# Soketin durduğu dizin: /run/panel-helper
#
# Soket doğrudan /run altında bir DOSYA iken, Docker onu bind-mount ederken
# yola değil inode'a bağlanıyordu. Helper her yeniden başlayışında soketi
# silip yeniden yarattığı için panel container'ı silinmiş inode'da kalıyor ve
# her istek ECONNREFUSED alıyordu. Dizin mount'ları içeriği canlı çözüyor.
#
# Preserve=yes ŞART: onsuz systemd dizini servis DURUNCA siler ve container'ın
# mount'u bu kez dizin düzeyinde kör kalır — sorunu bir kat yukarı taşırdık.
RuntimeDirectory=panel-helper
RuntimeDirectoryMode=0755
RuntimeDirectoryPreserve=yes

# Root gerekiyor (shutdown, systemctl) ama gereksiz yetkiler kapalı.
NoNewPrivileges=no
ProtectHome=read-only
PrivateTmp=yes

[Install]
WantedBy=multi-user.target
UNIT

systemctl daemon-reload
systemctl enable --now panel-helper.service

# `enable --now` ZATEN ÇALIŞAN bir servisi yeniden başlatmaz. İlk kurulumda bu
# satır gereksiz görünür; gerekli olduğu yer YÜKSELTMEDİR: yukarıda yeni
# panel-helper.py kopyalandı ama eski Python süreci onu görmeden çalışmaya
# devam ederdi. Ortaya çıkan hata da teşhisi zor olurdu — "helper'ı
# güncelledim, panel hâlâ eylemi tanımıyor".
#
# allow.conf için gerekmez: o dosya her istekte yeniden okunur.
systemctl restart panel-helper.service

sleep 1
systemctl --no-pager --lines=0 status panel-helper.service || true

# Soketin GERÇEKTEN soket olarak doğduğunu doğrula. Sessizce devam edip
# "kurulum tamam" demek yanlış olurdu.
SOCK=/run/panel-helper/panel-helper.sock
if [ ! -S "$SOCK" ]; then
  echo
  echo "!! UYARI: $SOCK bir soket DEĞİL." >&2
  if [ -d "$SOCK" ]; then
    echo "   Dizin olarak duruyor. Sırayla:" >&2
    echo "     docker compose down" >&2
    echo "     sudo rmdir $SOCK" >&2
    echo "     sudo systemctl restart panel-helper" >&2
    echo "     docker compose up -d" >&2
  else
    echo "   Helper başlayamamış olabilir: journalctl -u panel-helper -n 30" >&2
  fi
  echo
fi

# Eski sürümden kalan tekil soket dosyası. Zararsız ama kafa karıştırıcı:
# container hâlâ onu mount ediyorsa hiçbir komut çalışmaz ve sebebi
# görünmez olur.
if [ -e /run/panel-helper.sock ]; then
  echo
  echo "!! Eski soket yolu duruyor: /run/panel-helper.sock" >&2
  echo "   Bu sürümde soket $SOCK altına taşındı. Eskisini kaldır:" >&2
  echo "     sudo rm -f /run/panel-helper.sock   # dizinse: sudo rmdir ..." >&2
  echo "   ve docker-compose.yml'deki mount satırını güncelle (aşağıda)." >&2
  echo
fi

echo
echo "=========================================================="
echo "Kurulum tamam."
echo
echo "1) Panelin .env dosyasına şu satırı ekle:"
echo
echo "   HELPER_SECRET=$(cat "$CONF_DIR/secret")"
echo
echo "2) docker-compose.yml'de soket DİZİNİNİ container'a bağla:"
echo
echo "   volumes:"
echo "     - /run/panel-helper:/run/panel-helper"
echo
echo "   (Dosya değil dizin: helper yeniden başlayınca soket dosyası"
echo "    yeniden yaratılıyor ve dosyayı mount eden container eskisinde"
echo "    kalıp ECONNREFUSED alıyor.)"
echo
if [ "$ALLOW_IS_NEW" -eq 1 ]; then
  echo "3) $CONF_DIR/allow.conf içinde ihtiyacın olan satırları aç."
  echo "   Şu an HİÇBİR eyleme izin yok — bu kasıtlı."
else
  # Yükseltme. Mevcut liste korundu, yani bu sürümle gelen YENİ eylemler
  # (ör. shell.preset) orada yok — şablon yalnızca dosya ilk kez
  # oluşturulurken yazılır. Bunu söylememek, "kurdum ama çalışmıyor"
  # sonucunu doğuran türden bir sessizlik olurdu.
  echo "3) $CONF_DIR/allow.conf KORUNDU — mevcut satırların olduğu gibi duruyor."
  echo "   Bu sürümle gelen yeni eylemleri kullanacaksan onları ELLE ekle;"
  echo "   şablondaki örnekler için host-helper/install.sh içine bak."
  echo "   (Dosya her istekte okunur, düzenledikten sonra restart gerekmez.)"
fi
echo "=========================================================="
