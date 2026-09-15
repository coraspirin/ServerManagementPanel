import { guardApi } from "@/lib/auth/api";
import { audit } from "@/lib/auth/audit";
import { fail2banState, failedLogins, unban } from "@/lib/security/fail2ban";
import { auditSshKeys } from "@/lib/security/sshkeys";
import {
  annotateForward,
  forgetForward,
  scanPortForwards,
  storedForwards,
} from "@/lib/security/upnp";
import { latestScans, scanAllImages } from "@/lib/security/vuln";
import { clientIp } from "@/lib/request";

export const dynamic = "force-dynamic";

/**
 * M3.8 — güvenlik izleme uçları.
 *
 * Her bölüm AYRI sorgulanıyor: CVE taraması dakikalar, SSH denetimi saniyeler,
 * fail2ban milisaniyeler sürüyor. Hepsini tek yanıtta toplamak, ekranın en
 * yavaş parçayı beklemesi demek olurdu.
 */
export async function GET(request: Request) {
  const guard = await guardApi(request, "security.view");
  if (!guard.ok) return guard.response;

  const mode = new URL(request.url).searchParams.get("mode");

  switch (mode) {
    case "fail2ban":
      return Response.json({ fail2ban: await fail2banState(), failedLogins: failedLogins() });
    case "ssh":
      return Response.json({ ssh: await auditSshKeys() });
    case "vuln":
      return Response.json({ scans: latestScans() });
    case "forwards":
      return Response.json({ forwards: storedForwards() });
    default:
      // Varsayılan: yalnızca ucuz olanlar.
      return Response.json({
        scans: latestScans(),
        forwards: storedForwards(),
        failedLogins: failedLogins(),
      });
  }
}

export async function POST(request: Request) {
  const guard = await guardApi(request, "security.manage");
  if (!guard.ok) return guard.response;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "geçersiz istek" }, { status: 400 });
  }

  const action = String(body.action ?? "");
  const user = guard.session.user;

  if (action === "scan-vuln") {
    const outcome = await scanAllImages();
    audit({
      userId: user.id,
      username: user.username,
      action: "security.vuln_scan",
      detail: outcome.detail,
      ip: clientIp(request),
      result: "ok",
    });
    return Response.json({ ok: true, message: outcome.detail, scans: latestScans() });
  }

  if (action === "scan-upnp") {
    const outcome = await scanPortForwards();
    audit({
      userId: user.id,
      username: user.username,
      action: "security.upnp_scan",
      detail: outcome.message,
      ip: clientIp(request),
      result: "ok",
    });
    return Response.json({ ok: true, message: outcome.message, forwards: storedForwards() });
  }

  if (action === "unban") {
    const jail = String(body.jail ?? "");
    const ip = String(body.ip ?? "");
    const outcome = await unban(jail, ip, { username: user.username, userId: user.id });

    audit({
      userId: user.id,
      username: user.username,
      action: "security.unban",
      targetType: "fail2ban",
      targetId: `${jail}:${ip}`,
      detail: outcome.message,
      ip: clientIp(request),
      result: outcome.ok ? "ok" : "error",
    });

    return Response.json(
      { ...outcome, fail2ban: await fail2banState() },
      { status: outcome.ok ? 200 : 400 },
    );
  }

  if (action === "annotate-forward") {
    const key = String(body.key ?? "");
    annotateForward(key, String(body.note ?? ""), Boolean(body.acknowledged));

    audit({
      userId: user.id,
      username: user.username,
      action: "security.forward_note",
      targetType: "port_forward",
      targetId: key,
      detail: String(body.note ?? ""),
      result: "ok",
    });

    return Response.json({ ok: true, forwards: storedForwards() });
  }

  if (action === "forget-forward") {
    forgetForward(String(body.key ?? ""));
    return Response.json({ ok: true, forwards: storedForwards() });
  }

  return Response.json({ error: "Bilinmeyen işlem." }, { status: 400 });
}
