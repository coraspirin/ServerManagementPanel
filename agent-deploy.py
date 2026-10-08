#!/usr/bin/env python3
"""
Bir (ya da birkaç) uzak ajanı GitHub'da yayınlanan sürüme günceller:

    python agent-deploy.py 192.168.61.107

deploy.sh paneli kurar; bu betik ajanı doğrudan hedefte günceller. Panel
gerekmez, ajanın panelden kendini güncelleme özelliği olmayan eski
sürümlerde de çalışır — her şey bu bilgisayardan ssh ile yapılır:

  1. Hedefte ajan container'ı bulunur (PANEL_ROLE=agent); sürümü, imajı ve
     compose dizini okunur. Zaten istenen sürümdeyse atlanır.
  2. Hedef imajı GHCR'den kendisi çeker. Yayın iş akışı amd64, arm64 ve
     arm/v7 (DietPi / Raspberry Pi) için yayınlıyor; Docker hedefin
     mimarisine uyanı seçer.
  3. Ajanın compose dizininde .env yedeklenir, AGENT_IMAGE yeni imaja
     çevrilir, container yeniden yaratılır. Ajan ayağa kalkıp doğru sürümü
     bildirmezse .env geri yüklenir ve eski imajla yeniden başlatılır.

Ön koşul: sürüm GitHub'da yayınlanmış olmalı (`git push origin vX.Y.Z`
→ docker-publish iş akışı GHCR'ye X.Y.Z etiketini basar). Hedefe
parolasız ssh (anahtar) gerekir.

Seçenekler:
  HEDEF ...          IP/ad ya da kullanici@IP; birden fazla verilebilir
  --user KULLANICI   hedefteki ssh kullanıcısı (varsayılan: root)
  --version SÜRÜM    varsayılan: bu depodaki package.json sürümü
  --image REPO       varsayılan: ghcr.io/coraspirin/servermanagementpanel
  --sudo             hedefte docker'ı `sudo -n` ile çalıştır
  --force            sürüm aynı olsa da yeniden kur
  --dry-run          ne yapılacağını göster, hiçbir şeyi değiştirme
"""

from __future__ import annotations

import argparse
import json
import shlex
import subprocess
import sys
from datetime import datetime
from pathlib import Path

DEFAULT_USER = "root"
DEFAULT_REPO = "ghcr.io/coraspirin/servermanagementpanel"
SSH = ["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=8"]

# Hedefte çalışır. Ajanın container'ı PANEL_ROLE=agent ortam değişkeninden
# bulunur (container adı kuruluma göre değişiyor).
FIND_AGENT_SH = r"""
find_agent() {
  for id in $($D ps -aq); do
    if $D inspect -f '{{range .Config.Env}}{{println .}}{{end}}' "$id" 2>/dev/null | grep -qx 'PANEL_ROLE=agent'; then
      echo "$id"; return 0
    fi
  done
  return 1
}
"""

STATUS_SH = FIND_AGENT_SH + r"""
echo "ARCH=$(uname -m)"
C=$(find_agent) || { echo "NOAGENT"; exit 0; }
V=$($D exec "$C" printenv APP_VERSION 2>/dev/null || $D inspect -f '{{range .Config.Env}}{{println .}}{{end}}' "$C" | sed -n 's/^APP_VERSION=//p')
echo "VERSION=$V"
echo "IMAGE=$($D inspect -f '{{.Config.Image}}' "$C")"
echo "STATE=$($D inspect -f '{{.State.Status}}' "$C")"
echo "DIR=$($D inspect -f '{{index .Config.Labels "com.docker.compose.project.working_dir"}}' "$C")"
"""

SWITCH_SH = FIND_AGENT_SH + r"""
set -u
fail() { echo "!! $1"; exit 1; }
C=$(find_agent) || fail "ajan container'ı bulunamadı (PANEL_ROLE=agent)"
W=$($D inspect -f '{{index .Config.Labels "com.docker.compose.project.working_dir"}}' "$C")
P=$($D inspect -f '{{index .Config.Labels "com.docker.compose.project"}}' "$C")
S=$($D inspect -f '{{index .Config.Labels "com.docker.compose.service"}}' "$C")
[ -n "$W" ] && [ -n "$P" ] && [ -n "$S" ] || fail "ajan compose ile başlatılmamış"
cd "$W" || fail "dizin yok: $W"
[ -f .env ] && grep -q '^AGENT_IMAGE=' .env || fail "$W/.env içinde AGENT_IMAGE satırı yok"

$D image inspect "$NEW" >/dev/null 2>&1 || fail "imaj yok: $NEW"
B=".env.agent-deploy-$STAMP"
cp .env "$B" || fail "yedek alınamadı"
sed "s#^AGENT_IMAGE=.*#AGENT_IMAGE=$NEW#" .env > .env.agent-deploy-tmp && cat .env.agent-deploy-tmp > .env && rm -f .env.agent-deploy-tmp
echo "==> $W/.env: AGENT_IMAGE=$NEW (yedek: $B)"

rollback() {
  echo "==> geri alınıyor"
  cat "$B" > .env
  $D compose -p "$P" up -d --force-recreate "$S" 2>&1 | tail -3
}

OUT=$($D compose -p "$P" up -d --force-recreate "$S" 2>&1) || { echo "$OUT" | tail -5; rollback; fail "compose up"; }
echo "$OUT" | tail -3

# Doğrulama: container yeni imajla çalışıyor ve sağlık kontrolü geçiyor.
# APP_VERSION'a bakılmıyor — eski yayın imajları onu çalışma ortamına
# yazmıyor (sürüm koddaki varsayılandan geliyor).
i=0
H=missing
while [ $i -lt 60 ]; do
  C=$(find_agent) || C=""
  if [ -n "$C" ] && [ "$($D inspect -f '{{.Config.Image}}' "$C" 2>/dev/null)" = "$NEW" ]; then
    H=$($D inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$C" 2>/dev/null)
    case "$H" in
      healthy|running) echo "ajan çalışıyor: $NEW ($H)"; exit 0 ;;
      unhealthy|exited|dead) break ;;
    esac
  fi
  i=$((i + 1)); sleep 3
done
echo "son durum: $H"
[ -n "$C" ] && $D logs --tail 20 "$C" 2>&1 | sed 's/^/   log: /'
rollback
fail "ajan $NEW ile sağlıklı açılmadı"
"""


def run(cmd: list[str], *, input_text: str | None = None) -> str:
    # Bayt olarak: Windows'ta metin kipindeki stdin "\n"i "\r\n"e çevirir ve
    # uzaktaki sh betiği bozulur.
    data = input_text.encode("utf-8") if input_text is not None else None
    result = subprocess.run(cmd, input=data, capture_output=True)
    stdout = result.stdout.decode("utf-8", "replace")
    if result.returncode != 0:
        detail = (result.stderr.decode("utf-8", "replace") + "\n" + stdout).strip()
        raise RuntimeError(detail or f"çıkış kodu {result.returncode}")
    return stdout


def remote_sh(target: str, script: str, env: dict[str, str]) -> str:
    """Betiği ssh üzerinden `sh -s` ile çalıştırır; değişkenler başa yazılır."""
    prefix = "".join(f"{key}={shlex.quote(value)}\n" for key, value in env.items())
    return run(SSH + [target, "sh -s"], input_text=prefix + script)


def parse_status(text: str) -> dict[str, str]:
    if "NOAGENT" in text:
        return {}
    return dict(line.split("=", 1) for line in text.splitlines() if "=" in line)


def local_version() -> str:
    package = Path(__file__).resolve().parent / "package.json"
    return json.loads(package.read_text(encoding="utf-8"))["version"]


def pull(target: str, docker: str, image: str, version: str) -> None:
    """Hedef imajı kendisi çeker; ilerleme doğrudan terminale akar."""
    result = subprocess.run(SSH + [target, f"{docker} pull {shlex.quote(image)}"])
    if result.returncode != 0:
        raise RuntimeError(
            f"{image} çekilemedi. Sürüm GitHub'da yayınlandı mı? "
            f"(git push origin v{version} → GHCR'de {version} etiketi oluşmalı)"
        )


def indent(text: str) -> str:
    return "   " + text.strip().replace("\n", "\n   ")


def main() -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(description="Uzak ajanı GitHub'daki sürüme günceller.")
    parser.add_argument("targets", nargs="+", metavar="HEDEF", help="IP/ad ya da kullanici@IP")
    parser.add_argument("--user", default=DEFAULT_USER)
    parser.add_argument("--version")
    parser.add_argument("--image", default=DEFAULT_REPO)
    parser.add_argument("--sudo", action="store_true")
    parser.add_argument("--force", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    docker = "sudo -n docker" if args.sudo else "docker"
    version = (args.version or local_version()).removeprefix("v")
    image = f"{args.image}:{version}"
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    print(f"==> Hedef sürüm: {version}  ({image})")

    results: list[tuple[str, str]] = []
    for host in args.targets:
        target = host if "@" in host else f"{args.user}@{host}"
        print(f"\n==> {target}")
        try:
            status = parse_status(remote_sh(target, STATUS_SH, {"D": docker}))
            if not status:
                results.append((host, "HATA: sunucuda ajan container'ı bulunamadı (PANEL_ROLE=agent)"))
                continue
            # APP_VERSION yoksa (eski yayın imajları) imaj etiketinden.
            tag = status.get("IMAGE", "").rsplit(":", 1)[-1] if ":" in status.get("IMAGE", "") else ""
            current = status.get("VERSION") or (tag if tag[:1].isdigit() else "?")
            print(
                f"   şu an: {current} ({status.get('IMAGE')}, {status.get('STATE')}), "
                f"mimari: {status.get('ARCH')}, dizin: {status.get('DIR')}"
            )
            if current == version and not args.force:
                results.append((host, f"güncel ({current})"))
                continue
            if args.dry_run:
                results.append((host, f"YAPILACAK: {current} → {version}"))
                continue

            print("   imaj çekiliyor…")
            pull(target, docker, image, version)
            print("   ajan yeniden başlatılıyor…")
            out = remote_sh(target, SWITCH_SH, {"D": docker, "NEW": image, "VERSION": version, "STAMP": stamp})
            print(indent(out))
            results.append((host, f"GÜNCELLENDİ: {current} → {version}"))
        except RuntimeError as error:
            print(indent(f"!! {error}"))
            results.append((host, f"HATA: {str(error).splitlines()[-1]}"))

    print("\n==> Özet")
    for host, result in results:
        print(f"   {host}: {result}")
    return 1 if any(result.startswith("HATA") for _, result in results) else 0


if __name__ == "__main__":
    sys.exit(main())
