/**
 * Birleşik yetki/yetenek yönergesi (kararlar.md D6) — saf modül.
 *
 * Bir özellik çalışmadığında kullanıcıya üç şey söylenir: NEDEN, düzeltmenin
 * NEREDE yapılacağı (sunucuda mı, panelde mi) ve sunucudaysa çalıştırılacak
 * KOMUTLAR. Komutlar sunucuya özel üretilir: yerel sunucu (panelin kendi
 * compose'u) ile ajanlı sunucunun düzeltmesi farklı.
 *
 * Çeviri fonksiyonu ve sunucu bilgisi dışarıdan verilir (`hint.server.ts`
 * `serverT` + `getHost` ile sarar); modül testlerden doğrudan import edilir.
 * API yanıtlarında mevcut `error` metni korunur, bu nesne `hint` alanına
 * EKLENİR (istemci/mobil uyumu).
 */

export type PermissionHintCode =
  | "permission"
  | "noHost"
  | "unsupported"
  | "helperMissing"
  | "helperOutdated"
  /** Helper kurulu ama izin listesi panelden okunamaz — gereken satırlar. */
  | "helperUnverified"
  | "actionDisabled"
  | "patternDenied"
  | "socketMissing"
  | "socketDenied"
  | "socketStale"
  | "dockerMissing"
  | "procMissing"
  | "hostRootMissing"
  /** Native ajan bu özelliğin op'larını (henüz) sunmuyor. */
  | "agentOpMissing"
  /** Native ajan: host politikası (`policy.conf`) bu helper eylemlerine izin vermiyor. */
  | "policyMissing"
  /** Helper eylemi açık ama bu argümana (birim, kalıp, komut) izin yok — compose dışı desen reddi. */
  | "argumentDenied";

export type PermissionHint = {
  code: PermissionHintCode;
  /** Katalogdaki özellik anahtarı (`catalog.ts`), biliniyorsa. */
  feature: string | null;
  hostId: number | null;
  reason: string;
  fix: { where: "host" | "panel"; commands: string[] };
};

/** Komut üretmek için gereken sunucu özeti. */
export type HintHost = {
  id: number;
  name: string;
  address: string | null;
  local: boolean;
  /**
   * Native (Go) ajan: helper eylemleri ajanın içinde, izinler
   * `/etc/panel-agent/policy.conf`'ta (`allow helper.<eylem> [desen]`) —
   * allow.conf ve ayrı helper servisi yok, yeniden başlatma gerekmez.
   */
  native?: boolean;
};

export type HintContext = {
  host: HintHost | null;
  feature?: string | null;
  /** `permission`: eksik izin anahtarı. */
  need?: string;
  /** `actionDisabled`: helper eylemi. */
  action?: string;
  /** `patternDenied`: izin listesine eklenecek satırlar ve dizin. */
  allowLines?: string[];
  directory?: string;
  /** `argumentDenied`: reddedilen argüman (birim, kalıp ya da komut). */
  subject?: string;
  /** Soket hataları: container içindeki soket yolu. */
  socketPath?: string;
};

export type HintTranslate = (key: string, params?: Record<string, string | number>) => string;

const ALLOW_CONF = "/etc/panel-helper/allow.conf";
const RESTART_HELPER = "sudo systemctl restart panel-helper";
const POLICY_CONF = "/etc/panel-agent/policy.conf";

/** allow.conf satırı ("compose.up ^/opt/x$") → policy.conf satırı. */
export function policyLine(allowLine: string): string {
  return `allow helper.${allowLine.trim()}`;
}

/** Native ajanda helper izinleri policy.conf'ta; değişiklik anında geçerli. */
function nativeHelperCommands(code: PermissionHintCode, ctx: HintContext, t: HintTranslate): string[] | null {
  switch (code) {
    case "helperUnverified":
    case "patternDenied":
    case "argumentDenied":
    case "policyMissing":
      return [`# ${t("permissions.hint.policyConfShould")}`, `sudo tee -a ${POLICY_CONF} <<'EOF'`, ...(ctx.allowLines ?? []).map(policyLine), "EOF"];
    case "actionDisabled":
      return ctx.action
        ? [`echo '${policyLine(ctx.action)}' | sudo tee -a ${POLICY_CONF}`]
        : [`sudoedit ${POLICY_CONF}`];
    default:
      return null;
  }
}

/** Düzeltmesi sunucuda değil panelde olanlar. */
const PANEL_SIDE = new Set<PermissionHintCode>(["permission", "noHost", "unsupported", "agentOpMissing"]);

function hostHeader(ctx: HintContext, t: HintTranslate): string {
  const host = ctx.host;
  if (!host || host.local) return `# ${t("permissions.hint.where.local")}`;
  if (host.native) return `# ${t("permissions.hint.where.native", { host: host.name, address: host.address ?? "?" })}`;
  return `# ${t("permissions.hint.where.agent", { host: host.name, address: host.address ?? "?" })}`;
}

/** Compose'a satır ekleyip container'ı yeniden oluşturma — yerel ve ajan için aynı biçim. */
function composeMount(ctx: HintContext, t: HintTranslate, lines: string[]): string[] {
  const service = ctx.host && !ctx.host.local ? "panel-agent" : "panel";
  return [
    `# ${t("permissions.hint.composeVolumes", { service })}`,
    ...lines.map((line) => `#   ${line}`),
    "docker compose up -d",
  ];
}

function hostCommands(code: PermissionHintCode, ctx: HintContext, t: HintTranslate): string[] {
  if (ctx.host?.native) {
    const native = nativeHelperCommands(code, ctx, t);
    if (native) return native;
  }
  const agent = ctx.host !== null && !ctx.host.local;
  switch (code) {
    case "helperMissing":
      return [
        "sudo host-helper/install.sh",
        `# ${t("permissions.hint.secretToEnv", { file: agent ? t("permissions.hint.agentEnv") : ".env" })}`,
        ...(agent ? [] : [`# ${t("permissions.hint.composeVolumes", { service: "panel" })}`, "#   - /run/panel-helper:/run/panel-helper"]),
        "docker compose up -d",
      ];
    case "helperOutdated":
      return [`# ${t("permissions.hint.updateHelper")}`, "sudo host-helper/install.sh", RESTART_HELPER];
    case "helperUnverified":
      return [`# ${t("permissions.hint.allowConfShould")}`, `sudo tee -a ${ALLOW_CONF} <<'EOF'`, ...(ctx.allowLines ?? []), "EOF", RESTART_HELPER];
    case "actionDisabled":
      return ctx.action
        ? [`echo '${ctx.action}' | sudo tee -a ${ALLOW_CONF}`, RESTART_HELPER]
        : [`sudoedit ${ALLOW_CONF}`, RESTART_HELPER];
    case "patternDenied":
    case "argumentDenied":
      return [`sudo tee -a ${ALLOW_CONF} <<'EOF'`, ...(ctx.allowLines ?? []), "EOF", RESTART_HELPER];
    case "socketMissing":
      return ["systemctl status panel-helper", "sudo host-helper/install.sh", ...composeMount(ctx, t, ["- /run/panel-helper:/run/panel-helper"])];
    case "socketDenied":
      return [`ls -l ${ctx.socketPath ?? "/run/panel-helper/panel-helper.sock"}`, "sudo host-helper/install.sh", RESTART_HELPER];
    case "socketStale":
      return ["systemctl status panel-helper", RESTART_HELPER, `docker compose up -d --force-recreate ${agent ? "panel-agent" : "panel"}`];
    case "dockerMissing":
      return [
        "getent group docker | cut -d: -f3",
        `# ${t("permissions.hint.dockerGid")}`,
        ...composeMount(ctx, t, ["- /var/run/docker.sock:/var/run/docker.sock"]),
      ];
    case "procMissing":
      return composeMount(ctx, t, ["- /proc:/host/proc:ro"]);
    case "hostRootMissing":
      return composeMount(ctx, t, ["- /:/host/root:ro,rslave"]);
    default:
      return [];
  }
}

export function buildHint(code: PermissionHintCode, ctx: HintContext, t: HintTranslate): PermissionHint {
  const where = PANEL_SIDE.has(code) ? "panel" : "host";
  const params: Record<string, string | number> = {
    host: ctx.host?.name ?? "?",
    need: ctx.need ?? "?",
    action: ctx.action ?? "?",
    directory: ctx.directory ?? "?",
    path: ctx.socketPath ?? "?",
    actions: (ctx.allowLines ?? []).join(", ") || "?",
    subject: ctx.subject ?? "?",
  };
  const commands = where === "host" ? [hostHeader(ctx, t), ...hostCommands(code, ctx, t)] : [];
  return {
    code,
    feature: ctx.feature ?? null,
    hostId: ctx.host?.id ?? null,
    reason: t(`permissions.hint.${code}`, params),
    fix: { where, commands },
  };
}

/**
 * host-helper'ın döndürdüğü ham hata metninden ipucu kodu. Helper Python
 * tarafında Türkçe hata üretiyor; eşleşme bu sabit parçalarla yapılır.
 */
export function helperErrorCode(raw: string): PermissionHintCode | null {
  if (raw.includes("desene uymuyor")) return "patternDenied"; // i18n-ignore — helper'ın sabit hata metni
  if (raw.includes("izinli değil")) return "actionDisabled"; // i18n-ignore — helper'ın sabit hata metni
  if (raw.includes("bilinmeyen eylem")) return "helperOutdated"; // i18n-ignore — helper'ın sabit hata metni
  return null;
}

/** "eylem izinli değil: compose.up" → "compose.up" (son ":" sonrası). */
export function helperErrorAction(raw: string): string | undefined {
  const index = raw.lastIndexOf(":");
  if (index === -1) return undefined;
  const action = raw.slice(index + 1).trim();
  return /^[a-z0-9_]+(\.[a-z0-9_]+)+$/.test(action) ? action : undefined;
}
