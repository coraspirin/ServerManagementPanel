#!/usr/bin/env bash
# Native (Go) ajanı derler — tek statik ikili, CGO yok (kararlar.md K1).
#
#   bash scripts/build-agent.sh            # zorunlu hedefler
#   bash scripts/build-agent.sh --all      # + 386, armv6 (derlenir, "destekli" sayılmaz)
#
# Çıktı: agent/dist/panel-agent-linux-<arch> + SHA256SUMS. Sürüm package.json'dan.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

VERSION="$(node -p "require('./package.json').version")"
node scripts/agent-strings.mjs --check

# Zorunlu: amd64 (ZimaOS/x86 sunucular), arm64, armv7 (Raspberry Pi 2B).
TARGETS=("amd64::" "arm64::" "arm:7:v7")
if [[ "${1:-}" == "--all" ]]; then
  TARGETS+=("386::" "arm:6:v6")
fi

OUT="$ROOT/agent/dist"
mkdir -p "$OUT"
rm -f "$OUT"/panel-agent-linux-* "$OUT/SHA256SUMS"

cd "$ROOT/agent"
go vet ./...
go test ./...

for target in "${TARGETS[@]}"; do
  IFS=: read -r arch arm suffix <<<"$target"
  name="panel-agent-linux-${arch}${suffix}"
  CGO_ENABLED=0 GOOS=linux GOARCH="$arch" GOARM="$arm" \
    go build -trimpath -ldflags "-s -w -X main.version=$VERSION" -o "$OUT/$name" ./cmd/panel-agent
  printf '%-32s %s\n' "$name" "$(du -h "$OUT/$name" | cut -f1)"
done

cd "$OUT"
sha256sum panel-agent-linux-* > SHA256SUMS
echo "sürüm $VERSION → agent/dist/"
