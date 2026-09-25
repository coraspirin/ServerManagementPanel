/**
 * Panelin kendini GitHub sürümünden güncellemesi — saf parçalar.
 *
 * I/O yok, `@/` yolu yok: `node --test` altında doğrudan çalışsın diye.
 * Akışın kendisi `index.ts`'te; buradaki betik host'ta DEĞİL, panelin
 * docker.sock üzerinden başlattığı ayrı bir "updater" container'ında çalışır.
 */

import { compareVersions, parseTag } from "../updates/version.ts";

/** Yalnızca yayın etiketleri: `v1.10.0`. Ön sürümler ve dallar kurulmaz. */
const RELEASE_TAG = /^v\d+\.\d+\.\d+$/;

export function isReleaseTag(tag: string): boolean {
  return RELEASE_TAG.test(tag);
}

/** `sahip/depo` — URL'ye girdiği için dar tutuluyor. */
export function isRepoName(repo: string): boolean {
  return /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo);
}

/** Etiket listesinden en yeni yayın etiketi; hiç yoksa null. */
export function pickLatestTag(tags: string[]): string | null {
  let best: string | null = null;
  for (const tag of tags) {
    if (!isReleaseTag(tag)) continue;
    if (best === null || compareTags(tag, best) > 0) best = tag;
  }
  return best;
}

/** `v1.10.0` ile `1.9.0` karşılaştırması; baştaki `v` yok sayılır. */
export function compareTags(a: string, b: string): number {
  const left = parseTag(a.replace(/^v/, ""));
  const right = parseTag(b.replace(/^v/, ""));
  if (!left || !right) return 0;
  return compareVersions(left, right);
}

export type UpdatePhase = "idle" | "running" | "done" | "failed" | "rolledBack";

export type UpdateStateLine = {
  at: number;
  phase: UpdatePhase;
  tag: string | null;
  detail: string | null;
};

const PHASES: UpdatePhase[] = ["running", "done", "failed", "rolledBack"];

/**
 * Durum dosyası tek satır: `<unix> <evre> <etiket> [ayrıntı…]`. Betik de
 * panel de aynı biçimde yazıyor; bozuk ya da boş dosya "idle" sayılır.
 */
export function parseStateLine(text: string): UpdateStateLine {
  const [at, phase, tag, ...rest] = text.trim().split(/\s+/);
  if (!PHASES.includes(phase as UpdatePhase) || !Number.isFinite(Number(at))) {
    return { at: 0, phase: "idle", tag: null, detail: null };
  }
  return {
    at: Number(at),
    phase: phase as UpdatePhase,
    tag: tag || null,
    detail: rest.length ? rest.join(" ") : null,
  };
}

export function formatStateLine(at: number, phase: UpdatePhase, tag: string, detail?: string): string {
  return `${at} ${phase} ${tag}${detail ? ` ${detail}` : ""}\n`;
}

/**
 * Proje dizininde DEĞİŞTİRİLMEYEN adlar: sunucuya özel yapılandırma ve veri.
 * `.env.example` istisna — o depoya ait bir şablon.
 */
export const PRESERVED_NAMES = [
  ".env",
  ".env.*",
  "docker-compose*.yml",
  "docker-compose*.yaml",
  "compose*.yml",
  "compose*.yaml",
  "Caddyfile",
  "reports",
  "data",
  ".git",
  ".github",
  ".panel-backups",
];

/**
 * Updater container'ında (`docker:cli`, busybox) çalışan betik.
 *
 * Girdiler ortam değişkeni: TAG, WORKDIR (host yolu — container'a AYNI yolla
 * bağlı, çünkü compose göreli bind yollarını host yolu olarak çözüyor),
 * PROJECT, SERVICE, PANEL_CONTAINER, PANEL_IMAGE, STAMP, isteğe bağlı
 * COMPOSE_FILE. Panel verisi `/panel-data` altında; arşiv ve günlük orada.
 *
 * Güvenlik ağı üç katlı:
 *  1. Değiştirilen her şey önce `.panel-backups/panel-<STAMP>.tgz`'ye alınır.
 *  2. Derleme başarısızsa dosyalar geri yüklenir — compose derlemeyi
 *     container'ı değiştirmeden ÖNCE yaptığı için eski panel zaten ayakta.
 *  3. Yeni container sağlıklı olmazsa dosyalar ve önceki imaj geri alınıp
 *     panel eski sürümle yeniden yaratılır.
 */
export const UPDATER_SCRIPT = String.raw`set -u
D=/panel-data/updates
W="$WORKDIR"
exec >>"$D/update.log" 2>&1
state() { X=""; [ $# -gt 1 ] && X=$2; printf '%s %s %s %s\n' "$(date +%s)" "$1" "$TAG" "$X" > "$D/state.tmp" && mv "$D/state.tmp" "$D/state"; }
fail() { echo "!! $1"; state failed "$1"; exit 1; }
step() { echo "==> $1"; }

step "$TAG"
OWNER=$(stat -c %u:%g "$W") || fail workdir
T=$(mktemp -d)

step extract
tar -xzf "$D/$TAG.tar.gz" -C "$T" || fail extract
SRC=$(find "$T" -mindepth 1 -maxdepth 1 -type d | head -n 1)
[ -n "$SRC" ] && [ -f "$SRC/package.json" ] && [ -f "$SRC/Dockerfile" ] || fail archive

step backup
B="$W/.panel-backups"
BK="$B/panel-$STAMP.tgz"
mkdir -p "$B" || fail backup
ITEMS=$(cd "$W" && ls -A | grep -v -x -e .panel-backups -e reports -e data)
(cd "$W" && tar -czf "$BK" $ITEMS) || fail backup
chown "$OWNER" "$B" "$BK"
ls -1t "$B"/panel-*.tgz | tail -n +6 | xargs -r rm -f
echo "$BK"

ROLLBACK_IMAGE=panel-rollback:latest
docker image inspect "$PANEL_IMAGE" >/dev/null 2>&1 && docker tag "$PANEL_IMAGE" "$ROLLBACK_IMAGE"

: > "$T/items"
restore_files() {
  echo "==> restore"
  while read -r N; do rm -rf "$W/$N"; done < "$T/items"
  tar -xzf "$BK" -C "$W"
}

step files
for P in "$SRC"/* "$SRC"/.[!.]*; do
  [ -e "$P" ] || continue
  N=$(basename "$P")
  case "$N" in
    .env.example) ;;
    .env|.env.*|docker-compose*.yml|docker-compose*.yaml|compose*.yml|compose*.yaml|Caddyfile|reports|data|.git|.github|.panel-backups) continue ;;
  esac
  echo "$N" >> "$T/items"
  { rm -rf "$W/$N" && cp -a "$P" "$W/$N" && chown -R "$OWNER" "$W/$N"; } || { restore_files; fail "copy $N"; }
done

V=$(echo "$TAG" | sed 's/^v//')
if [ -f "$W/.env" ]; then
  if grep -q '^APP_VERSION=' "$W/.env"; then
    sed "s/^APP_VERSION=.*/APP_VERSION=$V/" "$W/.env" > "$T/env" && cat "$T/env" > "$W/.env"
  else
    printf '\nAPP_VERSION=%s\n' "$V" >> "$W/.env"
  fi
fi

step build
cd "$W" || fail workdir
state running build
if ! docker compose -p "$PROJECT" up -d --build "$SERVICE"; then
  restore_files
  fail build
fi

step health
state running health
S=starting
i=0
while [ $i -lt 60 ]; do
  S=$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$PANEL_CONTAINER" 2>/dev/null || echo missing)
  [ "$S" = healthy ] || [ "$S" = running ] || [ "$S" = unhealthy ] && break
  i=$((i + 1))
  sleep 5
done

if [ "$S" != healthy ] && [ "$S" != running ]; then
  echo "!! $S"
  restore_files
  if docker image inspect "$ROLLBACK_IMAGE" >/dev/null 2>&1; then
    docker tag "$ROLLBACK_IMAGE" "$PANEL_IMAGE"
    docker compose -p "$PROJECT" up -d --no-build --force-recreate "$SERVICE"
  else
    docker compose -p "$PROJECT" up -d --build "$SERVICE"
  fi
  state rolledBack "$S"
  exit 1
fi

rm -rf "$T" "$D/$TAG.tar.gz"
state done
step done
`;
