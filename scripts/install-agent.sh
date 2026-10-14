#!/usr/bin/env bash
# Sunucu Yönetim Paneli — native (Go) ajan kurulumu (kararlar.md K1/K3/K5).
#
#   curl -fsSL https://github.com/coraspirin/ServerManagementPanel/releases/latest/download/install-agent.sh \
#     | sudo bash -s -- --token <AGENT_TOKEN> [--central https://panel:3000] [--profile standard] [--port 7443]
#
# Seçenekler:
#   --token T        Panelin "Sunucu ekle" ekranındaki AGENT_TOKEN (≥32 karakter).
#                    Verilmezse ve kurulum varsa mevcut sır korunur.
#   --central URL    Panelin adresi. Verilirse ajan kurulunca kendini panele
#                    duyurur (1 saat içinde); panelde "bulundu → onayla".
#                    Verilmezse panelde adres elle girilir.
#   --profile P      readonly | standard (varsayılan) | full — yalnız ilk kurulumda
#                    yazılır; var olan /etc/panel-agent/policy.conf'a dokunulmaz.
#   --port N         Dinlenecek port (varsayılan 7443).
#   --version vX.Y.Z Belirli sürüm (varsayılan: en son yayın).
#   --uninstall      Servisi ve ikiliyi kaldırır (ayarlar ve sertifika kalır).
#   --purge          --uninstall + /etc/panel-agent ve /var/lib/panel-agent.
#
# Doğrulama: SHA256SUMS'un Ed25519 imzası aşağıdaki gömülü ortak anahtarla
# (OpenSSL 3) ve ikilinin özeti SHA256SUMS ile. İkisinden biri tutmazsa hiçbir
# şey kurulmaz. Ajan sonraki güncellemeleri kendisi, aynı anahtarla doğrulayarak
# yapar (panelde Sunucular → güncelle).
set -euo pipefail

REPO="coraspirin/ServerManagementPanel"
BASE_URL="${PANEL_AGENT_BASE_URL:-https://github.com/${REPO}/releases}"
# agent/internal/update/keys.go ile AYNI anahtar (PEM).
PUBLIC_KEY_PEM='-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEA2CbjyZxXu+HyB+Gy3kVMeVHT9rF+uKvmWB6b7YT1JPU=
-----END PUBLIC KEY-----'
# Yalnız deneme: başka anahtarla imzalanmış yerel bir yayını kurmak için
# (PANEL_AGENT_BASE_URL ile birlikte). Normal kurulumda kullanılmaz.
if [ -n "${PANEL_AGENT_PUBLIC_KEY:-}" ]; then
  PUBLIC_KEY_PEM="$PANEL_AGENT_PUBLIC_KEY"
fi

BIN=/usr/local/bin/panel-agent
CONF_DIR=/etc/panel-agent
DATA_DIR=/var/lib/panel-agent
UNIT=/etc/systemd/system/panel-agent.service

TOKEN=""
CENTRAL=""
PROFILE="standard"
PORT="7443"
VERSION=""
MODE="install"

die() { echo "HATA: $*" >&2; exit 1; }
info() { echo "==> $*"; }

while [ $# -gt 0 ]; do
  case "$1" in
    --token) TOKEN="${2:-}"; shift 2 ;;
    --central) CENTRAL="${2:-}"; shift 2 ;;
    --profile) PROFILE="${2:-}"; shift 2 ;;
    --port) PORT="${2:-}"; shift 2 ;;
    --version) VERSION="${2:-}"; shift 2 ;;
    --uninstall) MODE="uninstall"; shift ;;
    --purge) MODE="purge"; shift ;;
    -h|--help) sed -n '2,28p' "$0" 2>/dev/null || true; exit 0 ;;
    *) die "bilinmeyen seçenek: $1" ;;
  esac
done

[ "$(id -u)" -eq 0 ] || die "root olarak çalıştırın (sudo)"
command -v systemctl >/dev/null || die "systemd gerekli"

if [ "$MODE" != "install" ]; then
  info "panel-agent kaldırılıyor"
  systemctl disable --now panel-agent.service 2>/dev/null || true
  rm -f "$UNIT" "$BIN" "$BIN.prev" "$BIN.new"
  systemctl daemon-reload
  if [ "$MODE" = "purge" ]; then
    rm -rf "$CONF_DIR" "$DATA_DIR"
    info "ayarlar ve sertifika da silindi"
  else
    info "ayarlar ($CONF_DIR) ve sertifika ($DATA_DIR) korundu; tamamen silmek için --purge"
  fi
  exit 0
fi

case "$PROFILE" in readonly|standard|full) ;; *) die "profil readonly, standard ya da full olmalı" ;; esac
case "$PORT" in ''|*[!0-9]*) die "port sayı olmalı" ;; esac
if [ -n "$VERSION" ] && ! echo "$VERSION" | grep -Eq '^v[0-9]+\.[0-9]+\.[0-9]+$'; then
  die "sürüm vX.Y.Z biçiminde olmalı"
fi
if [ -n "$TOKEN" ] && [ "${#TOKEN}" -lt 32 ]; then
  die "token en az 32 karakter olmalı"
fi
if [ -n "$CENTRAL" ] && ! echo "$CENTRAL" | grep -Eq '^https?://[][A-Za-z0-9.:-]+$'; then
  die "--central http(s)://adres[:port] biçiminde olmalı (yol olmadan)"
fi
if [ -z "$TOKEN" ] && [ ! -f "$CONF_DIR/agent.env" ]; then
  die "--token gerekli (panel → Sunucular → Sunucu ekle)"
fi

case "$(uname -m)" in
  x86_64|amd64) ASSET=panel-agent-linux-amd64 ;;
  aarch64|arm64) ASSET=panel-agent-linux-arm64 ;;
  armv7l|armv7*) ASSET=panel-agent-linux-armv7 ;;
  armv6l) ASSET=panel-agent-linux-armv6 ;;
  i386|i486|i586|i686) ASSET=panel-agent-linux-386 ;;
  *) die "desteklenmeyen mimari: $(uname -m)" ;;
esac

if [ -n "$VERSION" ]; then
  URL="$BASE_URL/download/$VERSION"
else
  URL="$BASE_URL/latest/download"
fi

fetch() {
  if command -v curl >/dev/null; then curl -fsSL --retry 3 -o "$2" "$1"
  elif command -v wget >/dev/null; then wget -q -O "$2" "$1"
  else die "curl ya da wget gerekli"; fi
}

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

info "indiriliyor: $ASSET (${VERSION:-son sürüm})"
fetch "$URL/SHA256SUMS" "$TMP/SHA256SUMS"
fetch "$URL/SHA256SUMS.sig" "$TMP/SHA256SUMS.sig"
fetch "$URL/$ASSET" "$TMP/$ASSET"

info "imza doğrulanıyor"
command -v openssl >/dev/null || die "openssl gerekli (imza doğrulaması)"
printf '%s\n' "$PUBLIC_KEY_PEM" > "$TMP/pub.pem"
base64 -d "$TMP/SHA256SUMS.sig" > "$TMP/sig.bin" 2>/dev/null || die "imza dosyası bozuk"
openssl pkeyutl -verify -pubin -inkey "$TMP/pub.pem" -rawin -in "$TMP/SHA256SUMS" -sigfile "$TMP/sig.bin" >/dev/null 2>&1 \
  || die "SHA256SUMS imzası doğrulanamadı (OpenSSL 3 ve Ed25519 gerekli) — kurulum durduruldu"
expected="$(awk -v f="$ASSET" '$2 == f || $2 == "*" f { print $1 }' "$TMP/SHA256SUMS")"
[ -n "$expected" ] || die "SHA256SUMS'ta $ASSET yok"
actual="$(sha256sum "$TMP/$ASSET" | awk '{ print $1 }')"
[ "$expected" = "$actual" ] || die "ikilinin özeti tutmuyor — kurulum durduruldu"
chmod 755 "$TMP/$ASSET"
"$TMP/$ASSET" selftest >/dev/null || die "ikili bu sistemde çalışmıyor (selftest)"

info "kuruluyor"
install -d -m 700 "$CONF_DIR" "$DATA_DIR"
systemctl stop panel-agent.service 2>/dev/null || true
install -m 755 "$TMP/$ASSET" "$BIN"

if [ -n "$TOKEN" ] || [ -n "$CENTRAL" ] || [ ! -f "$CONF_DIR/agent.env" ]; then
  OLD_TOKEN=""
  if [ -f "$CONF_DIR/agent.env" ]; then
    OLD_TOKEN="$(grep -E '^AGENT_TOKEN=' "$CONF_DIR/agent.env" | cut -d= -f2- || true)"
    [ -n "$CENTRAL" ] || CENTRAL="$(grep -E '^AGENT_CENTRAL=' "$CONF_DIR/agent.env" | cut -d= -f2- || true)"
  fi
  [ -n "$TOKEN" ] || TOKEN="$OLD_TOKEN"
  # Yeni sır = yeni kayıt: ajan yeniden duyurabilsin diye işaret silinir.
  if [ "$TOKEN" != "$OLD_TOKEN" ]; then rm -f "$DATA_DIR/enrolled"; fi
  umask 077
  cat > "$CONF_DIR/agent.env" <<EOF
# panel-agent — install-agent.sh yazdı. Sır panelin "Sunucu ekle" ekranından.
AGENT_TOKEN=$TOKEN
AGENT_PORT=$PORT
AGENT_DATA=$DATA_DIR
AGENT_POLICY=$CONF_DIR/policy.conf
AGENT_CENTRAL=$CENTRAL
EOF
  chmod 600 "$CONF_DIR/agent.env"
fi

if [ ! -f "$CONF_DIR/policy.conf" ]; then
  cat > "$CONF_DIR/policy.conf" <<EOF
# Bu sunucunun ajana izin verdikleri (panel bu dosyayı değiştiremez).
# Profil: readonly | standard | full — güç, root kabuğu, paket yükseltme
# yalnız full. Tek tek açmak için: allow helper.<eylem> [desen]
# Değişiklik ajanı yeniden başlatmadan geçerli olur.
# Komutla: panel-agent policy show | profile <ad> | allow <op> [desen] | deny <op>
profile $PROFILE
EOF
  chmod 644 "$CONF_DIR/policy.conf"
fi

cat > "$UNIT" <<EOF
[Unit]
Description=Sunucu Yönetim Paneli ajanı (native)
After=network-online.target time-sync.target
Wants=network-online.target

[Service]
ExecStart=$BIN serve -env $CONF_DIR/agent.env
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now panel-agent.service >/dev/null
sleep 2
systemctl is-active --quiet panel-agent.service || die "servis başlamadı: journalctl -u panel-agent -n 50"

FINGERPRINT="$("$BIN" fingerprint -env "$CONF_DIR/agent.env")"
ADDRESS="$(hostname -I 2>/dev/null | awk '{ print $1 }')"
info "kuruldu: $("$BIN" version), profil $(awk '$1 == "profile" { print $2 }' "$CONF_DIR/policy.conf")"
echo
if [ -n "$CENTRAL" ] && [ ! -f "$DATA_DIR/enrolled" ]; then
  echo "Ajan kendini $CENTRAL adresine duyuruyor — panelde Sunucular ekranında onaylayın."
  echo "Duyuru ulaşmazsa elle: Sunucular → bu sunucu → kayıt adresi: https://${ADDRESS:-<sunucu-ip>}:$PORT"
else
  echo "Panelde: Sunucular → bu sunucu → kayıt adresi: https://${ADDRESS:-<sunucu-ip>}:$PORT"
fi
echo "Sertifika parmak izi (panelde görünenle aynı olmalı): $FINGERPRINT"
echo "Günlük: journalctl -u panel-agent -f   ·   İzinler: panel-agent policy show   ·   Denetim: panel-agent doctor"
