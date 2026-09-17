#!/usr/bin/env bash
# Paneli 192.168.61.114'e yükler: yedek → kopyala → derle → sağlık kontrolü.
# Proje kökünden çalıştır: bash deploy.sh
set -euo pipefail

HOST="192.168.61.114"
DIR="/home/coraspirin/docker/server-panel"
STAMP="$(date +%Y%m%d-%H%M)"
PKG="panel-deploy-$STAMP.tgz"
SSH="ssh -o BatchMode=yes -o ConnectTimeout=8"

echo "==> 1/6 Yerel kontroller"
npm run typecheck
npm test
npm run i18n:check
npm run i18n:scan

echo "==> 2/6 Paket hazırlanıyor"
PARCALAR="src scripts package.json package-lock.json"
[ -d public ] && PARCALAR="$PARCALAR public"
tar --force-local -czf "$PKG" $PARCALAR

echo "==> 3/6 Sunucuda yedek alınıyor"
$SSH "$HOST" "cd $DIR && tar -czf /home/coraspirin/panel-yedek-$STAMP.tgz $PARCALAR 2>/dev/null; ls -lh /home/coraspirin/panel-yedek-$STAMP.tgz"

echo "==> 4/6 Yükleniyor"
scp -o BatchMode=yes "$PKG" "$HOST:/tmp/$PKG"
rm -f "$PKG"
# src/scripts tamamen değiştiriliyor: yerelde silinen dosyalar sunucuda da kalmasın.
# docker-compose.yml, Caddyfile, .env gibi sunucuya özel dosyalara dokunulmuyor.
$SSH "$HOST" "cd $DIR && rm -rf src scripts && tar -xzf /tmp/$PKG && rm /tmp/$PKG"

echo "==> 5/6 Derleniyor ve başlatılıyor"
$SSH "$HOST" "cd $DIR && docker compose up -d --build 2>&1 | tail -5"

echo "==> 6/6 Sağlık kontrolü (işler için 90 sn bekleniyor)"
$SSH "$HOST" "
  for i in \$(seq 1 20); do
    s=\$(docker inspect server-panel-panel-1 --format '{{.State.Health.Status}}')
    [ \"\$s\" = healthy ] && break; sleep 4
  done
  echo \"container: \$s\"
  sleep 90
  hatalar=\$(docker logs --since 2m server-panel-panel-1 2>&1 | grep -iE 'error|unhandled|ECONN|\] .* hata:' | head -10)
  if [ -n \"\$hatalar\" ]; then echo 'LOGLARDA HATA VAR:'; echo \"\$hatalar\"; exit 1; fi
  echo 'Loglarda hata yok.'
"

echo "Tamam. Geri dönmek gerekirse yedek: /home/coraspirin/panel-yedek-$STAMP.tgz"
