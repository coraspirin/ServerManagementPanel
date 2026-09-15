import { guardApi } from "@/lib/auth/api";
import { queryAudit, type AuditFilter } from "@/lib/auth/audit";

export const dynamic = "force-dynamic";

/** Sorgu parametrelerini filtreye çevirir; boş/geçersiz olanlar yok sayılır. */
export function parseAuditFilter(url: URL): AuditFilter {
  const num = (key: string): number | undefined => {
    const raw = url.searchParams.get(key);
    if (!raw) return undefined;
    const value = Number(raw);
    return Number.isFinite(value) ? value : undefined;
  };
  const str = (key: string): string | undefined => url.searchParams.get(key)?.trim() || undefined;

  return {
    q: str("q"),
    username: str("username"),
    action: str("action"),
    result: str("result"),
    since: num("since"),
    until: num("until"),
    limit: num("limit"),
    offset: num("offset"),
  };
}

export async function GET(request: Request) {
  const guard = await guardApi(request, "audit.view");
  if (!guard.ok) return guard.response;

  const url = new URL(request.url);
  const page = queryAudit(parseAuditFilter(url));

  // CSV dışa aktarımı: filtrelenmiş sonucu olduğu gibi indirir. Denetim
  // kayıtlarının panelin dışında saklanması gerekebilir.
  if (url.searchParams.get("format") === "csv") {
    const escape = (value: string) => `"${value.replaceAll('"', '""')}"`;
    const rows = [
      "zaman,kullanici,islem,hedef_tipi,hedef,sonuc,ip,detay",
      ...page.records.map((record) =>
        [
          new Date(record.ts * 1000).toISOString(),
          record.username,
          record.action,
          record.targetType,
          record.targetId,
          record.result,
          record.ip,
          record.detail,
        ]
          .map(escape)
          .join(","),
      ),
    ].join("\n");

    return new Response("﻿" + rows, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="audit-${new Date()
          .toISOString()
          .slice(0, 10)}.csv"`,
      },
    });
  }

  return Response.json(page);
}
