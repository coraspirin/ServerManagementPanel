#!/usr/bin/env bash
# Paneli 192.168.61.114'e yükler: yedek → kopyala → derle → sağlık kontrolü.
# Proje kökünden (git deposunun kökünden) çalıştır: bash deploy.sh
set -euo pipefail

HOST="192.168.61.114"
DIR="/home/coraspirin/docker/server-panel"
CONTAINER="server-panel-panel-1"
STAMP="$(date +%Y%m%d-%H%M)"
PKG="panel-deploy-$STAMP.tgz"
SSH="ssh -o BatchMode=yes -o ConnectTimeout=8"

# Yalnızca deponun kökünden: başka bir kopyadan (ör. eski bir `.deploy-head`
# anlık görüntüsü) çalıştırılınca o kopyanın ESKİ kodu yüklenir ve sunucu
# "yüklendi ama güncellenmedi" durumuna düşer.
ROOT="$(git rev-parse --show-toplevel 2>/dev/null || true)"
if [ -z "$ROOT" ] || [ "$(cd "$ROOT" && pwd -P)" != "$(pwd -P)" ]; then
  echo "!! deploy.sh git deposunun kökünden çalıştırılmalı (şu an: $(pwd))." >&2
  exit 1
fi

VERSION="$(node -p "require('./package.json').version")"
COMMIT="$(git rev-parse --short HEAD)"
DIRTY=""
[ -n "$(git status --porcelain -- src scripts package.json package-lock.json)" ] && DIRTY=" (+commitlenmemiş değişiklikler)"
echo "==> Yüklenecek: v$VERSION @ $COMMIT$DIRTY"

echo "==> 1/6 Yerel kontroller"
npm run typecheck
npm test
npm run i18n:check
npm run i18n:scan

echo "==> 2/6 Paket hazırlanıyor"
# Derlemeye giren her şey: yalnızca src/scripts gönderilirse sunucudaki eski
# Dockerfile / next.config ile derlenir.
PARCALAR="src scripts fixtures host-helper package.json package-lock.json Dockerfile .dockerignore next.config.ts tsconfig.json postcss.config.mjs"
[ -d public ] && PARCALAR="$PARCALAR public"
tar --force-local -czf "$PKG" $PARCALAR

echo "==> 3/6 Sunucuda yedek alınıyor"
$SSH "$HOST" "cd $DIR && tar -czf /home/coraspirin/panel-yedek-$STAMP.tgz $PARCALAR .env 2>/dev/null; ls -lh /home/coraspirin/panel-yedek-$STAMP.tgz"

echo "==> 4/6 Yükleniyor"
scp -o BatchMode=yes "$PKG" "$HOST:/tmp/$PKG"
rm -f "$PKG"
# src/scripts tamamen değiştiriliyor: yerelde silinen dosyalar sunucuda da kalmasın.
# docker-compose.yml, Caddyfile gibi sunucuya özel dosyalara dokunulmuyor.
# .env'de YALNIZCA APP_VERSION güncelleniyor (tekrarlanan satırlar tek satıra
# iniyor): compose onu imaja ve container'a veriyor, eski değer kalırsa panel
# yeni kodla eski sürüm numarasını gösterir.
$SSH "$HOST" "cd $DIR && rm -rf src scripts && tar -xzf /tmp/$PKG && rm /tmp/$PKG \
  && grep -v '^APP_VERSION=' .env > .env.deploy-tmp && echo 'APP_VERSION=$VERSION' >> .env.deploy-tmp \
  && cat .env.deploy-tmp > .env && rm .env.deploy-tmp"

echo "==> 5/6 Derleniyor ve başlatılıyor"
$SSH "$HOST" "cd $DIR && docker compose build panel 2>&1 | tail -5 && docker compose up -d 2>&1 | tail -5"

echo "==> 6/6 Sağlık kontrolü (işler için 90 sn bekleniyor)"
$SSH "$HOST" "
  for i in \$(seq 1 20); do
    s=\$(docker inspect $CONTAINER --format '{{.State.Health.Status}}')
    [ \"\$s\" = healthy ] && break; sleep 4
  done
  echo \"container: \$s\"
  v=\$(docker exec $CONTAINER printenv APP_VERSION)
  if [ \"\$v\" != '$VERSION' ]; then echo \"!! Çalışan sürüm \$v, beklenen $VERSION\"; exit 1; fi
  echo \"çalışan sürüm: \$v\"
  sleep 90
  hatalar=\$(docker logs --since 2m $CONTAINER 2>&1 | grep -iE 'error|unhandled|ECONN|\] .* hata:' | head -10)
  if [ -n \"\$hatalar\" ]; then echo 'LOGLARDA HATA VAR:'; echo \"\$hatalar\"; exit 1; fi
  echo 'Loglarda hata yok.'
"

echo "Tamam. Geri dönmek gerekirse yedek: /home/coraspirin/panel-yedek-$STAMP.tgz"
