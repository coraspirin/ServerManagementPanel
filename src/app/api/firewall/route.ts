import { serverT } from "@/lib/i18n/runtime";
import { guardApi } from "@/lib/auth/api";
import { audit } from "@/lib/auth/audit";
import {
  addRule,
  dangerousChange,
  deleteRule,
  firewallState,
  setDefaultPolicy,
  setEnabled,
  type FirewallChange,
  type RuleOutcome,
} from "@/lib/security/firewall";
import { clientIp } from "@/lib/request";

export const dynamic = "force-dynamic";

/**
 * M3.18 — güvenlik duvarı.
 *
 * M3.7'de bu uçlar `/api/security` içindeydi; ekran kendi menüsüne çıkınca
 * uçlar da onunla taşındı. DENETİM KAYDI ADLARI DEĞİŞMEDİ (`firewall.allow`,
 * `firewall.deny`, `firewall.delete`) — geçmiş kayıtlar sorgulanabilir kalmalı.
 */
export async function GET(request: Request) {
  const guard = await guardApi(request, "security.view");
  if (!guard.ok) return guard.response;

  return Response.json(await firewallState());
}

export async function POST(request: Request) {
  const guard = await guardApi(request, "security.manage");
  if (!guard.ok) return guard.response;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: serverT("api.invalidRequest") }, { status: 400 });
  }

  const actor = { username: guard.session.user.username, userId: guard.session.user.id };
  const action = String(body.action ?? "");

  const record = async (
    auditAction: string,
    targetId: string,
    outcome: RuleOutcome,
  ) => {
    audit({
      userId: actor.userId,
      username: actor.username,
      action: auditAction,
      targetType: "ufw_rule",
      targetId,
      detail: outcome.message,
      ip: clientIp(request),
      result: outcome.ok ? "ok" : "error",
    });

    return Response.json(
      { ...outcome, firewall: await firewallState() },
      { status: outcome.ok ? 200 : 400 },
    );
  };

  /**
   * Tehlikeli değişiklikler onay ister.
   *
   * Durum HER SEFERİNDE yeniden okunuyor: `enable` kontrolü kural listesine
   * bakıyor ve istemcinin gönderdiği listeye güvenmek, eski bir ekranla
   * gelen isteğin kontrolü atlaması demekti.
   */
  const confirmed = async (change: FirewallChange) => {
    if (body.confirmed) return null;
    const warning = dangerousChange(change, await firewallState());
    if (!warning) return null;
    return Response.json({ error: warning, needsConfirmation: true }, { status: 409 });
  };

  if (action === "add") {
    const rule = String(body.rule ?? "").trim();
    const kind = body.kind === "deny" ? "deny" : "allow";
    const comment = String(body.comment ?? "").trim();

    const blocked = await confirmed({ kind: "rule", rule, action: kind });
    if (blocked) return blocked;

    return record(`firewall.${kind}`, rule, await addRule(rule, kind, actor, comment));
  }

  if (action === "delete") {
    const number = Number(body.number ?? 0);
    return record("firewall.delete", String(number), await deleteRule(number, actor));
  }

  if (action === "enable" || action === "disable") {
    const enable = action === "enable";

    // Kapatmak tehlikeli değil: sunucuyu korumasız bırakır ama erişimi
    // kesmez. Onay yalnızca AÇMADA isteniyor.
    if (enable) {
      const blocked = await confirmed({ kind: "enable" });
      if (blocked) return blocked;
    }

    return record(`firewall.${action}`, "ufw", await setEnabled(enable, actor));
  }

  if (action === "default") {
    const policy = String(body.policy ?? "");
    const direction = String(body.direction ?? "");

    const blocked = await confirmed({ kind: "default", policy, direction });
    if (blocked) return blocked;

    return record(
      "firewall.default",
      `${direction}:${policy}`,
      await setDefaultPolicy(policy, direction, actor),
    );
  }

  return Response.json({ error: serverT("api.unknownAction") }, { status: 400 });
}
