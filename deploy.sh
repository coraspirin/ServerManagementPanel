#!/usr/bin/env bash
# Paneli ZimaOS/CasaOS sunucusundaki mevcut uygulamaya yükler:
#   kontrol → paket → kaynak klasörüne yükle → imajı SUNUCUDA derle →
#   CasaOS compose'unda yalnızca `image:` satırını değiştir → yeniden başlat → sağlık.
# Proje kökünden (git deposunun kökünden) çalıştır: bash deploy.sh
#
# Sunucudaki düzen (CasaOS uygulaması "server-management-panel"):
#   - compose: CasaOS'un kendi dizininde (container etiketinden bulunur)
#   - veri:    /DATA/AppData/server-panel  → container'da /app/data (DOKUNULMAZ)
#   - kaynak:  /DATA/AppData/server-panel-src  (yalnızca derleme için; veriyle KARIŞMAZ)
# ZimaOS'ta kök dosya sistemi (/home dahil) salt-okunur; yazılabilir yerler /DATA, /tmp.
#
# Değiştirilebilir:
#   PANEL_HOST=…  PANEL_CONTAINER=…  PANEL_SRC=…  bash deploy.sh
set -euo pipefail
cd "$(dirname "$0")"

# PowerShell'de `bash` çoğu zaman WSL'dir: orada Node/npm (yerel kontroller)
# ve Windows'taki SSH anahtarı yok. Git Bash varsa betik kendini onunla
# yeniden başlatır; WSL, Windows programının çalışma dizinini kendisi çevirir.
if ! command -v node >/dev/null 2>&1; then
  for GIT_BASH in "/mnt/c/Program Files/Git/bin/bash.exe" "/c/Program Files/Git/bin/bash.exe"; do
    if [ -x "$GIT_BASH" ]; then
      echo "==> Node bu kabukta yok; Git Bash ile devam ediliyor"
      exec "$GIT_BASH" "$(basename "$0")" "$@"
    fi
  done
  echo "!! Node bulunamadı. Git Bash'ten çalıştır: \"C:\\Program Files\\Git\\bin\\bash.exe\" deploy.sh" >&2
  exit 1
fi

HOST="${PANEL_HOST:-192.168.61.114}"
CONTAINER="${PANEL_CONTAINER:-server-management-panel}"
SRC="${PANEL_SRC:-/DATA/AppData/server-panel-src}"
IMAGE="server-panel:local"
STAMP="$(date +%Y%m%d-%H%M)"
PKG="panel-deploy-$STAMP.tgz"
SSH="ssh -o BatchMode=yes -o ConnectTimeout=10"

# Yalnızca deponun kökünden: başka bir kopyadan (ör. eski bir `.deploy-head`
# anlık görüntüsü) çalıştırılınca o kopyanın ESKİ kodu yüklenir ve sunucu
# "yüklendi ama güncellenmedi" durumuna düşer.
ROOT="$(git rev-parse --show-toplevel 2>/dev/null || true)"
if [ -z "$ROOT" ] || [ "$(cd "$ROOT" && pwd -P)" != "$(pwd -P)" ]; then
  echo "!! deploy.sh git deposunun kökünden çalıştırılmalı (şu an: $(pwd))." >&2
  exit 1
fi

VERSION="$(awk -F'"' '/^  "version": "/ { print $4; exit }' package.json)"
COMMIT="$(git rev-parse --short HEAD)"
DIRTY=""
[ -n "$(git status --porcelain -- src scripts package.json package-lock.json Dockerfile)" ] && DIRTY=" (+commitlenmemiş değişiklikler)"
echo "==> Yüklenecek: v$VERSION @ $COMMIT$DIRTY → $HOST ($CONTAINER)"

echo "==> 0/6 Sunucu yoklanıyor"
# Compose dizini ve servis adı CasaOS'un koyduğu etiketlerden okunur: dizin adı
# (compose-<id>) CasaOS'a özel ve yeniden kurulumda değişir, elle yazılmamalı.
INFO="$($SSH "$HOST" bash -s -- "$CONTAINER" <<'REMOTE'
C="$1"
command -v docker >/dev/null 2>&1 || { echo "ERR docker yok"; exit 0; }
docker inspect "$C" >/dev/null 2>&1 || { echo "ERR '$C' adlı container yok (CasaOS'ta uygulama kurulu mu?)"; exit 0; }
dir=$(docker inspect "$C" --format '{{index .Config.Labels "com.docker.compose.project.working_dir"}}')
svc=$(docker inspect "$C" --format '{{index .Config.Labels "com.docker.compose.service"}}')
img=$(docker inspect "$C" --format '{{.Config.Image}}')
[ -f "$dir/docker-compose.yml" ] || { echo "ERR compose bulunamadı: $dir/docker-compose.yml"; exit 0; }
echo "OK|$dir|$svc|$img"
REMOTE
)"
case "$INFO" in
  OK\|*) IFS='|' read -r _ CASA_DIR SERVICE CURRENT_IMAGE <<<"$INFO" ;;
  *) echo "!! ${INFO#ERR }" >&2; exit 1 ;;
esac
echo "    compose: $CASA_DIR/docker-compose.yml (servis: $SERVICE)"
echo "    şu anki imaj: $CURRENT_IMAGE"

echo "==> 1/6 Yerel kontroller"
npm run typecheck
npm test
npm run i18n:check
npm run i18n:scan

echo "==> 2/6 Paket hazırlanıyor"
# Derlemeye giren her şey (Dockerfile'ın COPY ettikleri).
PARCALAR="src scripts fixtures host-helper package.json package-lock.json Dockerfile .dockerignore next.config.ts tsconfig.json postcss.config.mjs"
[ -d public ] && PARCALAR="$PARCALAR public"
tar --force-local -czf "$PKG" $PARCALAR

echo "==> 3/6 Yükleniyor ($SRC)"
scp -o BatchMode=yes "$PKG" "$HOST:/tmp/$PKG"
rm -f "$PKG"
# Kaynak klasörü her seferinde baştan kuruluyor: yerelde silinen dosyalar
# sunucuda kalıp derlemeye karışmasın. Bu klasör YALNIZCA derleme içindir.
$SSH "$HOST" "mkdir -p '$SRC' && find '$SRC' -mindepth 1 -delete && tar -xzf '/tmp/$PKG' -C '$SRC' && rm -f '/tmp/$PKG'"

echo "==> 4/6 İmaj sunucuda derleniyor ($IMAGE) — birkaç dakika sürebilir"
# Önceki yerel derlemenin kimliği: yeni imaj başarıyla çalışınca silinecek.
OLD_LOCAL="$($SSH "$HOST" "docker image inspect '$IMAGE' --format '{{.Id}}' 2>/dev/null || true")"
$SSH "$HOST" bash -s -- "$SRC" "$VERSION" "$IMAGE" <<'REMOTE'
set -o pipefail
cd "$1"
# Derleme çıktısı uzun; yalnızca son satırlar. Hata olursa çıkış kodu korunur.
docker build --build-arg APP_VERSION="$2" -t "$3" . 2>&1 | tail -15
REMOTE

echo "==> 5/6 CasaOS compose güncelleniyor ve yeniden başlatılıyor"
# Yalnızca `image:` satırı değişiyor. Port, veri klasörü, MASTER_KEY, kaynak
# sınırları — CasaOS'ta ayarlanan her şey olduğu gibi kalır. Eski compose
# yanına yedekleniyor; geri dönmek = yedeği geri koyup `up -d`.
$SSH "$HOST" bash -s -- "$CASA_DIR" "$SERVICE" "$IMAGE" "$STAMP" <<'REMOTE'
set -euo pipefail
DIR="$1"; SVC="$2"; IMG="$3"; STAMP="$4"
cd "$DIR"
cp -p docker-compose.yml "docker-compose.yml.deploy-$STAMP.bak"
# Servis bloğunun içindeki ilk `image:` satırı (CasaOS'un tek servisli dosyası).
awk -v svc="$SVC" -v img="$IMG" '
  $0 ~ "^[[:space:]]+" svc ":[[:space:]]*$" { insvc=1 }
  insvc && !done && $0 ~ /^[[:space:]]+image:/ { sub(/image:.*/, "image: " img); done=1 }
  { print }
' docker-compose.yml > docker-compose.yml.deploy-tmp
grep -q "image: $IMG" docker-compose.yml.deploy-tmp || { echo "!! image satırı değiştirilemedi"; rm -f docker-compose.yml.deploy-tmp; exit 1; }
cat docker-compose.yml.deploy-tmp > docker-compose.yml && rm -f docker-compose.yml.deploy-tmp
# --pull never: yerel imaj kayıt defterinde yok; compose onu çekmeye kalkmasın.
docker compose up -d --pull never "$SVC" 2>&1 | tail -5
REMOTE

echo "==> 6/6 Sağlık kontrolü (işler için 90 sn bekleniyor)"
$SSH "$HOST" bash -s -- "$CONTAINER" "$VERSION" "$OLD_LOCAL" "$IMAGE" <<'REMOTE'
C="$1"; VERSION="$2"; OLD="$3"; IMG="$4"
for i in $(seq 1 30); do
  s=$(docker inspect "$C" --format '{{.State.Health.Status}}' 2>/dev/null)
  [ "$s" = healthy ] && break; sleep 4
done
echo "container: $s"
v=$(docker exec "$C" printenv APP_VERSION)
if [ "$v" != "$VERSION" ]; then echo "!! Çalışan sürüm $v, beklenen $VERSION"; exit 1; fi
echo "çalışan sürüm: $v"
sleep 90
hatalar=$(docker logs --since 2m "$C" 2>&1 | grep -iE 'error|unhandled|ECONN|\] .* hata:' | head -10)
if [ -n "$hatalar" ]; then echo 'LOGLARDA HATA VAR:'; echo "$hatalar"; exit 1; fi
echo 'Loglarda hata yok.'
# Bir önceki yerel derleme artık etiketsiz; yalnızca ONU sil (genel prune
# başka uygulamaların imajlarına da dokunurdu).
NEW=$(docker image inspect "$IMG" --format '{{.Id}}')
if [ -n "$OLD" ] && [ "$OLD" != "$NEW" ]; then docker rmi "$OLD" >/dev/null 2>&1 && echo "eski yerel imaj silindi."; fi
REMOTE

PORT="$($SSH "$HOST" "docker port '$CONTAINER' 3000/tcp 2>/dev/null | head -1 | sed 's/.*://'")"
echo "Tamam. Panel: http://$HOST:${PORT:-?}"
echo "Geri dönmek gerekirse (sunucuda):"
echo "  cd '$CASA_DIR' && cp docker-compose.yml.deploy-$STAMP.bak docker-compose.yml && docker compose up -d $SERVICE"
echo "  (önceki imaj: $CURRENT_IMAGE)"
echo "  ⚠️ Yeni sürüm bir migration çalıştırdıysa eski imaj yeni şemayla açılmayabilir: önce"
echo "     /DATA/AppData/server-panel/backups/pre-migration-<n>.db dosyasını panel.db yerine koy."
