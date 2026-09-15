#!/usr/bin/env bash
#
# M1.10 — İşletim sistemi güncelleme raporu.
#
# HOST'ta çalışır, container'da DEĞİL. Sebep `hardware.sh` ile aynı: `apt`
# host'un paket veritabanını okur ve `apt update` root ister. Bunları
# container'a taşımak, panelin host paket yöneticisine yazma yetkisi olması
# demekti. Bunun yerine script host'ta çalışır ve sonucu SALT VERİ olarak
# bırakır; panel yalnızca JSON okur, hiçbir komut çalıştırmaz.
#
# GÜNCELLEME KURMAZ. Yalnızca "ne var" der. Kurma işi bilinçli olarak insana
# bırakıldı: bir çekirdek güncellemesi yeniden başlatma ister ve bunu gece
# 3'te kendiliğinden yapan bir panel, çözdüğünden çok sorun çıkarır.
#
# Kurulum (sunucuda, panel dizininde):
#   sudo install -m 700 scripts/os-updates.sh /usr/local/bin/panel-os-updates.sh
#   sudo tee /etc/cron.d/panel-os-updates <<EOF
#   17 6 * * * root PANEL_REPORTS_DIR=$PWD/reports /usr/local/bin/panel-os-updates.sh
#   EOF
#
# Panel bu dizini `./reports:/app/reports:ro` olarak bağlar — SALT OKUNUR.
#
set -uo pipefail

OUTPUT_DIR="${PANEL_REPORTS_DIR:-./reports}"
OUTPUT_FILE="${OUTPUT_DIR}/os-updates.json"
TMP_FILE="$(mktemp)"
trap 'rm -f "$TMP_FILE"' EXIT

mkdir -p "$OUTPUT_DIR"

errors=()
packages_json="[]"
reboot_required="false"
security_count=0
total_count=0

if ! command -v apt-get >/dev/null 2>&1; then
  errors+=("apt bulunamadı — bu script Debian/Ubuntu içindir")
else
  # Paket listesini tazele. Başarısız olursa (ağ yok) eski listeyle devam
  # edilir; "hiç güncelleme yok" demek, "bakamadım" demekten kötüdür, bu
  # yüzden hata da rapora yazılır.
  if ! apt-get update -qq >/dev/null 2>&1; then
    errors+=("apt-get update başarısız — liste eski olabilir")
  fi

  # Paket listesi için ÖNCE python3-apt denenir.
  #
  # Sebep bir tuzak: Ubuntu güvenlik yamalarını hem `-security` hem `-updates`
  # havuzuna koyar. `apt-get -s upgrade` çıktısında paketin kaynağı olarak
  # yalnızca BİRİ görünür — genelde `-updates`. O çıktıdaki metne bakarak
  # "güvenlik mi" demek, gerçek güvenlik yamalarını "sıradan güncelleme"
  # olarak göstermek demekti. python3-apt aday sürümün TÜM kaynaklarını
  # verir; doğru cevap orada. (Ubuntu'nun kendi `apt-check` aracı da böyle
  # yapar.)
  packages_json="$(python3 - <<'PY' 2>/dev/null
import json

try:
    import apt
except ImportError:
    raise SystemExit(1)

cache = apt.Cache()
packages = []

for pkg in cache:
    if not pkg.is_upgradable:
        continue
    candidate = pkg.candidate
    if candidate is None:
        continue
    archives = [(origin.archive or "") for origin in candidate.origins]
    packages.append({
        "name": pkg.name,
        "current": pkg.installed.version if pkg.installed else None,
        "candidate": candidate.version,
        "security": any(archive.endswith("-security") for archive in archives),
    })

packages.sort(key=lambda item: (not item["security"], item["name"]))
print(json.dumps(packages, ensure_ascii=False))
PY
  )"

  if [ -z "$packages_json" ]; then
    # python3-apt yoksa `apt-get -s upgrade` ayrıştırılır. Bu yolda güvenlik
    # tespiti yukarıdaki sebeple GÜVENİLMEZDİR; rapora not düşülür.
    errors+=("python3-apt yok — güvenlik güncellemesi sayısı eksik olabilir")
    upgradable="$(apt-get -s -o Debug::NoLocking=true upgrade 2>/dev/null | grep '^Inst ' || true)"

    if [ -n "$upgradable" ]; then
      packages_json="$(
        printf '%s\n' "$upgradable" | python3 -c '
import json, re, sys

packages = []
for line in sys.stdin:
    line = line.strip()
    if not line.startswith("Inst "):
        continue
    # Inst <ad> [<eski>] (<yeni> <kaynak>) ...
    match = re.match(r"^Inst (\S+) (?:\[(\S+)\] )?\((\S+) (.+?)\)", line)
    if not match:
        continue
    name, current, candidate, origin = match.groups()
    packages.append({
        "name": name,
        "current": current,
        "candidate": candidate,
        "security": "security" in origin.lower(),
    })

print(json.dumps(packages, ensure_ascii=False))
' 2>/dev/null
      )"
    fi
    [ -z "$packages_json" ] && packages_json="[]"
  fi

  total_count="$(printf '%s' "$packages_json" | python3 -c 'import json,sys; print(len(json.load(sys.stdin)))' 2>/dev/null || echo 0)"
  security_count="$(printf '%s' "$packages_json" | python3 -c 'import json,sys; print(sum(1 for p in json.load(sys.stdin) if p["security"]))' 2>/dev/null || echo 0)"
fi

[ -f /var/run/reboot-required ] && reboot_required="true"

errors_json="$(printf '%s\n' "${errors[@]+"${errors[@]}"}" | python3 -c '
import json, sys
print(json.dumps([line for line in sys.stdin.read().split("\n") if line.strip()], ensure_ascii=False))
' 2>/dev/null || echo '[]')"

cat > "$TMP_FILE" <<EOF
{
  "reportedAt": $(date +%s),
  "total": ${total_count:-0},
  "security": ${security_count:-0},
  "rebootRequired": ${reboot_required},
  "packages": ${packages_json},
  "errors": ${errors_json}
}
EOF

# Atomik taşıma: panel yarısı yazılmış bir JSON okumasın.
mv "$TMP_FILE" "$OUTPUT_FILE"
chmod 644 "$OUTPUT_FILE"
