import "server-only";

import { callHelper, helperConfigured } from "@/lib/host/helper";
import {
  parseUfwStatus,
  parseUfwVerbose,
  type FirewallState,
} from "@/lib/security/ufw";

// Saf ayrıştırma ve tehlike değerlendirmesi `ufw.ts` içinde; buradan
// yeniden ihraç ediliyor ki çağıranlar tek bir modül bilsin.
export {
  dangerousChange,
  panelPorts,
  parseUfwStatus,
  parseUfwVerbose,
  type FirewallChange,
  type FirewallDefaults,
  type FirewallRule,
  type FirewallState,
} from "@/lib/security/ufw";

/**
 * M3.7 / M3.18 — ufw yönetimi.
 *
 * Kural söz dizimi HOST tarafında doğrulanıyor (T4): helper yalnızca
 * `port/proto` ya da `from <ip> to any port <n>` kalıplarını kabul ediyor.
 * Serbest metni ufw'ye geçirmek, izin listesini anlamsız kılardı — "ufw'yi
 * çalıştırabilir" ile "istediği kuralı yazabilir" aynı şey olurdu.
 *
 * İzin listesinde satır yoksa ekran çalışmaya devam eder ve NE YAPILMASI
 * gerektiğini söyler. Sessizce boş bir liste göstermek, "güvenlik duvarında
 * hiç kural yok" gibi tehlikeli bir yanlış anlamaya yol açardı.
 *
 * ⚠️ UFW'NİN SINIRI: Docker, ufw'yi ATLAR. Docker kendi iptables kurallarını
 * `DOCKER-USER` zincirine ve nat `PREROUTING`'e yazar; bunlar ufw'nin
 * `filter INPUT` zincirinden önce çalışır. Yayınlanmış bir container portuna
 * yazılan `deny` kuralı ETKİSİZDİR. Panel bunu gizlemiyor: hangi portların
 * Docker tarafından yayınlandığı Port Haritası'ndan (M3.17) geliyor ve ilgili
 * kuralın yanında uyarı olarak gösteriliyor. Bunu göstermemek, olmayan bir
 * güvenliği varmış gibi sunmak olurdu.
 */

/** Otomatik okumalar panel adına yapılır; kullanıcı eylemleri kendi aktörüyle. */
const ACTOR = { username: "panel", userId: 0 };

const ACTIONS_LINE =
  "ufw.status\\nufw.status_verbose\\nufw.allow\\nufw.deny\\nufw.delete\\n" +
  "ufw.enable\\nufw.disable\\nufw.default\\nufw.logging\\nufw.app_list\\n";

const ALLOW_HINT =
  "host'ta root olarak:\n" + `printf '${ACTIONS_LINE}' >> /etc/panel-helper/allow.conf`;

const UPGRADE_HINT =
  "host'ta root olarak (helper'ın kendisi güncellenmeli, sonra izin listesi):\n" +
  "cd /home/coraspirin/docker/server-panel && install -m 755 host-helper/panel-helper.py /usr/local/lib/panel-helper/panel-helper.py && systemctl restart panel-helper\n" +
  `printf '${ACTIONS_LINE}' >> /etc/panel-helper/allow.conf`;

/**
 * Helper'ın verdiği hatayı iki farklı duruma ayırır.
 *
 * "bilinmeyen eylem" = host'taki helper ESKİ, yeni eylemleri tanımıyor.
 * "izinli değil"     = helper güncel ama izin listesinde satır yok.
 * İkisi farklı çözüm gerektiriyor ve aynı mesajı vermek kullanıcıyı yanlış
 * komuta yönlendirirdi.
 */
function classify(error: string): { message: string; hint: string } | null {
  if (error.includes("bilinmeyen eylem")) {
    return {
      message:
        "Host'taki helper bu eylemi tanımıyor — panel güncellendi ama helper eski sürümde kaldı.",
      hint: UPGRADE_HINT,
    };
  }
  if (error.includes("izinli değil")) {
    return {
      message:
        "host-helper izin listesinde ufw eylemleri yok. Bu, kural OLMADIĞI anlamına GELMEZ — panel yalnızca göremiyor.",
      hint: ALLOW_HINT,
    };
  }
  return null;
}

export async function firewallState(): Promise<FirewallState> {
  if (!helperConfigured()) {
    return {
      available: false,
      active: false,
      rules: [],
      defaults: null,
      logging: null,
      message: "host-helper kurulmamış; güvenlik duvarı panelden okunamıyor.",
      setupHint: null,
    };
  }

  const response = await callHelper("ufw.status", {}, ACTOR);

  if (!response.ok) {
    const classified = classify(response.error ?? "");
    return {
      available: false,
      active: false,
      rules: [],
      defaults: null,
      logging: null,
      message: classified?.message ?? response.error ?? "ufw okunamadı",
      setupHint: classified?.hint ?? null,
    };
  }

  const parsed = parseUfwStatus(response.stdout ?? "");

  // Varsayılan politika AYRI bir çağrı: ufw `status verbose` ile `numbered`'ı
  // birlikte kabul etmiyor. Bu eylem izin listesinde yoksa ekran çalışmaya
  // devam eder, yalnızca varsayılanlar "bilinmiyor" görünür.
  const verbose = await callHelper("ufw.status_verbose", {}, ACTOR);
  const extra = verbose.ok
    ? parseUfwVerbose(verbose.stdout ?? "")
    : { defaults: null, logging: null };

  return {
    available: true,
    active: parsed.active,
    rules: parsed.rules,
    defaults: extra.defaults,
    logging: extra.logging,
    message: parsed.active
      ? `Güvenlik duvarı etkin — ${parsed.rules.length} kural.`
      : "Güvenlik duvarı KAPALI. Kurallar tanımlı olsa bile uygulanmıyor.",
    setupHint: null,
  };
}

export type RuleOutcome = { ok: boolean; message: string };

function outcome(
  response: { ok: boolean; exitCode?: number; stdout?: string; error?: string },
  fallback: string,
  failure: string,
): RuleOutcome {
  return {
    ok: response.ok && (response.exitCode ?? 1) === 0,
    message: response.ok ? (response.stdout ?? "").trim() || fallback : (response.error ?? failure),
  };
}

export async function addRule(
  rule: string,
  action: "allow" | "deny",
  actor: { username: string; userId: number },
  comment = "",
): Promise<RuleOutcome> {
  const response = await callHelper(
    action === "allow" ? "ufw.allow" : "ufw.deny",
    comment ? { rule, comment } : { rule },
    actor,
  );

  return outcome(response, "Kural eklendi.", "Kural eklenemedi.");
}

export async function deleteRule(
  number: number,
  actor: { username: string; userId: number },
): Promise<RuleOutcome> {
  const response = await callHelper("ufw.delete", { number: String(number) }, actor);
  return outcome(response, "Kural silindi.", "Kural silinemedi.");
}

export async function setEnabled(
  enabled: boolean,
  actor: { username: string; userId: number },
): Promise<RuleOutcome> {
  const response = await callHelper(enabled ? "ufw.enable" : "ufw.disable", {}, actor);
  return outcome(
    response,
    enabled ? "Güvenlik duvarı etkinleştirildi." : "Güvenlik duvarı kapatıldı.",
    "İşlem yapılamadı.",
  );
}

export async function setDefaultPolicy(
  policy: string,
  direction: string,
  actor: { username: string; userId: number },
): Promise<RuleOutcome> {
  const response = await callHelper("ufw.default", { policy, direction }, actor);
  return outcome(response, "Varsayılan politika değişti.", "Politika değiştirilemedi.");
}
