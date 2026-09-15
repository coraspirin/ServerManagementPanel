#!/usr/bin/env bash
#
# M1.4 — S.M.A.R.T ve ZFS raporu.
#
# HOST'ta çalışır, container'da DEĞİL. Sebep: `smartctl` ham disk erişimi
# (CAP_SYS_RAWIO) ister, `zpool` host araçlarını. Bunları container'a vermek,
# paneli okuyabilsin diye tüm disklere ham erişim açmak demekti. Bunun yerine
# script host'ta root olarak çalışır ve sonucu SALT VERİ olarak bırakır; panel
# yalnızca JSON okur, hiçbir komut çalıştırmaz.
#
# Kurulum (sunucuda, panel dizininde):
#   sudo apt install smartmontools
#   sudo install -m 700 scripts/hardware.sh /usr/local/bin/panel-hardware.sh
#   mkdir -p reports
#   sudo tee /etc/cron.d/panel-hardware <<EOF
#   */30 * * * * root PANEL_REPORTS_DIR=$PWD/reports /usr/local/bin/panel-hardware.sh
#   EOF
#
# Panel bu dizini `./reports:/app/reports:ro` olarak bağlar — SALT OKUNUR.
#
set -uo pipefail

OUTPUT_DIR="${PANEL_REPORTS_DIR:-./reports}"
OUTPUT_FILE="${OUTPUT_DIR}/hardware.json"
TMP_FILE="$(mktemp)"
trap 'rm -f "$TMP_FILE"' EXIT

errors=()
disks_json="[]"
pools_json="[]"

json_escape() {
  python3 -c 'import json,sys; print(json.dumps(sys.stdin.read().rstrip("\n")))' 2>/dev/null \
    || printf '"%s"' "$(cat | tr -d '"' | tr '\n' ' ')"
}

# --- S.M.A.R.T --------------------------------------------------------------

if ! command -v smartctl >/dev/null 2>&1; then
  errors+=("smartctl bulunamadı — 'apt install smartmontools' gerekiyor")
elif ! command -v python3 >/dev/null 2>&1; then
  errors+=("python3 bulunamadı — JSON birleştirme için gerekiyor")
else
  # --json çıktısını Python ile normalize ediyoruz: smartctl sürümleri arasında
  # alan adları değişiyor ve jq her sunucuda kurulu olmuyor.
  devices="$(lsblk -dn -o NAME,TYPE 2>/dev/null | awk '$2=="disk"{print "/dev/"$1}')"
  disks_json="$(
    python3 - <<'PY' "$devices"
import json, subprocess, sys

def attr(table, name):
    for row in table:
        if row.get("name") == name:
            raw = row.get("raw", {})
            return raw.get("value")
    return None

disks = []
for device in (sys.argv[1] or "").split():
    try:
        out = subprocess.run(
            ["smartctl", "--json", "-H", "-A", "-i", device],
            capture_output=True, text=True, timeout=30,
        ).stdout
        data = json.loads(out)
    except Exception:
        continue

    # Sanal disklerde S.M.A.R.T yoktur; sessizce atla.
    if not data.get("device") or data.get("smart_support", {}).get("available") is False:
        continue

    table = data.get("ata_smart_attributes", {}).get("table", [])
    nvme = data.get("nvme_smart_health_information_log", {})

    disks.append({
        "device": device,
        "model": data.get("model_name") or data.get("scsi_model_name") or "bilinmiyor",
        "serial": data.get("serial_number"),
        "sizeBytes": (data.get("user_capacity") or {}).get("bytes"),
        "health": "PASSED" if (data.get("smart_status") or {}).get("passed") is True
                  else ("FAILED" if (data.get("smart_status") or {}).get("passed") is False
                        else "bilinmiyor"),
        "temperatureC": (data.get("temperature") or {}).get("current"),
        "powerOnHours": (data.get("power_on_time") or {}).get("hours"),
        "reallocatedSectors": attr(table, "Reallocated_Sector_Ct"),
        "pendingSectors": attr(table, "Current_Pending_Sector"),
        "uncorrectableErrors": attr(table, "Offline_Uncorrectable"),
        "percentageUsed": nvme.get("percentage_used"),
    })

print(json.dumps(disks))
PY
  )" || { errors+=("smartctl okuması başarısız"); disks_json="[]"; }
fi

# --- ZFS --------------------------------------------------------------------

if command -v zpool >/dev/null 2>&1 && command -v python3 >/dev/null 2>&1; then
  pools_json="$(
    python3 - <<'PY'
import json, re, subprocess

pools = []
try:
    names = subprocess.run(["zpool", "list", "-H", "-o", "name"],
                           capture_output=True, text=True, timeout=20).stdout.split()
except Exception:
    names = []

for name in names:
    try:
        text = subprocess.run(["zpool", "status", name],
                              capture_output=True, text=True, timeout=30).stdout
    except Exception:
        continue

    state = (re.search(r"state:\s*(\S+)", text) or [None, "bilinmiyor"])[1]
    scan = re.search(r"scan:\s*(.+)", text)
    scrub_result = scan.group(1).strip() if scan else None

    devices = []
    for line in text.splitlines():
        m = re.match(r"\s{4,}(\S+)\s+(ONLINE|DEGRADED|FAULTED|OFFLINE|UNAVAIL|REMOVED)", line)
        if m and m.group(1) != name:
            devices.append({"name": m.group(1), "state": m.group(2)})

    pools.append({
        "name": name,
        "kind": "zfs",
        "state": state,
        "healthy": state == "ONLINE",
        "detail": (re.search(r"status:\s*(.+)", text).group(1).strip()
                   if re.search(r"status:\s*(.+)", text) else f"{len(devices)} aygıt"),
        "devices": devices,
        "lastScrubAt": None,
        "scrubResult": scrub_result,
    })

print(json.dumps(pools))
PY
  )" || { errors+=("zpool okuması başarısız"); pools_json="[]"; }
fi

# --- Yaz --------------------------------------------------------------------

errors_json="$(printf '%s\n' "${errors[@]+"${errors[@]}"}" | python3 -c \
  'import json,sys; print(json.dumps([l for l in sys.stdin.read().splitlines() if l]))' 2>/dev/null || echo "[]")"

mkdir -p "$OUTPUT_DIR"
cat > "$TMP_FILE" <<EOF
{
  "generatedAt": $(date +%s),
  "disks": ${disks_json},
  "pools": ${pools_json},
  "errors": ${errors_json}
}
EOF

# Atomik değiştirme: panel yarım yazılmış bir dosya okumasın.
mv "$TMP_FILE" "$OUTPUT_FILE"
chmod 644 "$OUTPUT_FILE"
trap - EXIT
