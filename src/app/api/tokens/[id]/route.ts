import { guardApi } from "@/lib/auth/api";
import { audit } from "@/lib/auth/audit";
import { findApiToken, revokeApiToken } from "@/lib/auth/apitoken";
import { hasPermission } from "@/lib/auth/session";
import { tokenAuditTag } from "@/lib/apiv1/redact";
import { clientIp } from "@/lib/request";

export const dynamic = "force-dynamic";

/**
 * Anahtar iptali (T12).
 *
 * DELETE ama satır silinmiyor — `revoked_at` damgalanıyor. "Bu anahtar ne
 * zaman ve kim tarafından kapatıldı" sorusunun cevabı kalmalı; budaması ayrı
 * bir işte (`api.tokens_prune`).
 */
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await guardApi(request, "api.manage");
  if (!guard.ok) return guard.response;

  const user = guard.session.user;
  const id = Number((await params).id);
  if (!Number.isInteger(id)) {
    return Response.json({ error: "geçersiz anahtar" }, { status: 400 });
  }

  const token = findApiToken(id);
  // Başkasının anahtarı için de 404: "var ama senin değil" demek, yönetici
  // olmayan birine sistemdeki anahtarların varlığını sızdırırdı.
  if (!token || (token.userId !== user.id && !hasPermission(user, "users.manage"))) {
    return Response.json({ error: "anahtar bulunamadı" }, { status: 404 });
  }

  if (!revokeApiToken(id)) {
    return Response.json({ error: "anahtar zaten iptal edilmiş" }, { status: 400 });
  }

  audit({
    userId: user.id,
    username: user.username,
    action: "api.token_revoke",
    targetType: "api_token",
    targetId: String(id),
    detail: `${tokenAuditTag(token.name, token.prefix)} sahibi ${token.username}`,
    ip: clientIp(request),
    result: "ok",
  });

  return Response.json({ ok: true });
}
