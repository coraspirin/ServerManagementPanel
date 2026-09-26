#!/usr/bin/env bash
# Panel sürümünü tek komutla değiştirir.
#
# Kullanım (proje kökünden):
#   bash scripts/set-version.sh 1.12.0          # belirli sürüm
#   bash scripts/set-version.sh patch|minor|major
#   bash scripts/set-version.sh minor --commit  # ayrıca "chore: release X" commit'i + vX etiketi
#
# Sürüm şu yerlerde yazılı; hepsi birlikte güncellenir:
#   package.json, package-lock.json, Dockerfile (ARG), docker-compose.yml
#   (varsayılanlar), src/lib/env.ts (yedek değer), README.md, README_tr.md,
#   screenshots/README.md.
# Yalnızca sürümün geçtiği bilinen satırlar değişir: kodda/testlerde aynı
# numara örnek olarak geçse bile dokunulmaz.
set -euo pipefail

# Proje kökü betiğin kendi konumundan: git yalnızca --commit için gerekli.
cd "$(dirname "$0")/.."

ARG="${1:-}"
COMMIT=0
[ "${2:-}" = "--commit" ] && COMMIT=1

if [ -z "$ARG" ]; then
  echo "Kullanım: bash scripts/set-version.sh <X.Y.Z|patch|minor|major> [--commit]" >&2
  exit 1
fi

# Node gerekmez: PowerShell'den çağrılan `bash` çoğu zaman WSL'dir ve orada
# Node kurulu olmayabilir. Sürüm package.json'ın üst düzey alanından okunur.
OLD="$(awk -F'"' '/^  "version": "/ { print $4; exit }' package.json)"
if ! [[ "$OLD" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "!! package.json'dan sürüm okunamadı: '$OLD'" >&2
  exit 1
fi
IFS=. read -r MAJOR MINOR PATCH <<< "$OLD"

case "$ARG" in
  patch) NEW="$MAJOR.$MINOR.$((PATCH + 1))" ;;
  minor) NEW="$MAJOR.$((MINOR + 1)).0" ;;
  major) NEW="$((MAJOR + 1)).0.0" ;;
  *) NEW="${ARG#v}" ;;
esac

if ! [[ "$NEW" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "!! Geçersiz sürüm: $NEW (beklenen X.Y.Z)" >&2
  exit 1
fi
SKIP_EDIT=0
if [ "$NEW" = "$OLD" ]; then
  if [ "$COMMIT" = 0 ]; then
    echo "Sürüm zaten $OLD." >&2
    exit 0
  fi
  # Dosyalar önceden güncellenmiş; yalnızca commit + etiket.
  SKIP_EDIT=1
fi
if [ "$COMMIT" = 1 ] && git rev-parse -q --verify "refs/tags/v$NEW" >/dev/null; then
  echo "!! v$NEW etiketi zaten var." >&2
  exit 1
fi

echo "==> $OLD → $NEW"

edit_files() {

# JSON dosyaları: yalnızca projenin KENDİ sürüm satırları. package.json'da
# üst düzey `"version"` (2 boşluk girinti); package-lock.json'da üst düzey ve
# `packages[""]` altındaki ilk iki satır — bağımlılıkların sürümleri dosyanın
# ilerisinde ve tesadüfen aynı numarayı taşısalar da değişmez.
replace_json_version() {
  local file="$1" limit="$2"
  awk -v o="\"version\": \"$OLD\"" -v n="\"version\": \"$NEW\"" -v max="$limit" '
    c < max && NR <= 20 && (i = index($0, o)) > 0 {
      $0 = substr($0, 1, i - 1) n substr($0, i + length(o)); c++
    }
    { print }' "$file" > "$file.tmp"
  if ! cmp -s "$file" "$file.tmp"; then
    cat "$file.tmp" > "$file"
    echo "    $file"
  fi
  rm -f "$file.tmp"
}
replace_json_version package.json 1
replace_json_version package-lock.json 2

# Diğerleri: yalnızca sürüm taşıyan satırlarda eski numara yenisiyle değişir.
# (awk index() düz metin arar; "1.11.1" içindeki noktalar regex sayılmaz.)
replace_in_lines() {
  local file="$1" marker="$2"
  [ -f "$file" ] || return 0
  awk -v o="$OLD" -v n="$NEW" -v m="$marker" '
    index($0, m) { r = ""; s = $0
      while ((i = index(s, o)) > 0) { r = r substr(s, 1, i - 1) n; s = substr(s, i + length(o)) }
      $0 = r s }
    { print }' "$file" > "$file.tmp"
  if ! cmp -s "$file" "$file.tmp"; then
    cat "$file.tmp" > "$file"
    echo "    $file"
  fi
  rm -f "$file.tmp"
}

replace_in_lines Dockerfile "ARG APP_VERSION="
replace_in_lines docker-compose.yml "APP_VERSION"
replace_in_lines src/lib/env.ts "process.env.APP_VERSION"
for readme in README.md README_tr.md screenshots/README.md; do
  replace_in_lines "$readme" "**Version:**"
  replace_in_lines "$readme" "**Sürüm:**"
  replace_in_lines "$readme" "| \`APP_VERSION\` |"
done

# Kalan var mı? (bilinen yerlerde eski numara kalmamalı)
LEFT="$(grep -nF "$OLD" package.json Dockerfile docker-compose.yml src/lib/env.ts README.md README_tr.md 2>/dev/null || true)"
if [ -n "$LEFT" ]; then
  echo "!! Eski sürüm hâlâ geçiyor, elle kontrol et:" >&2
  echo "$LEFT" >&2
fi

}

[ "$SKIP_EDIT" = 0 ] && edit_files

if [ "$COMMIT" = 1 ]; then
  git add package.json package-lock.json Dockerfile docker-compose.yml src/lib/env.ts \
    README.md README_tr.md screenshots/README.md
  git commit -m "chore: release $NEW"
  git tag "v$NEW"
  echo "==> Commit ve v$NEW etiketi hazır. Yayınlamak için: git push && git push origin v$NEW"
else
  echo "==> Tamam. Commit için: bash scripts/set-version.sh $NEW --commit (ya da elle)"
fi
