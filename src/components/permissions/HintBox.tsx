"use client";

import { useState } from "react";
import { Copy, Server, SlidersHorizontal } from "lucide-react";
import { copyText } from "@/lib/client/clipboard";
import { useT } from "@/lib/i18n/client";
import type { PermissionHint } from "@/lib/permissions/hint";

/**
 * Birleşik yönerge kutusu (kararlar.md D6): neden + düzeltmenin yeri +
 * sunucuya özel komutlar (kopyalanabilir). Neden metni sunucuda çevrilmiş
 * gelir; burada yalnız çerçeve metinleri çevrilir.
 */
export function HintBox({ hint, compact = false }: { hint: PermissionHint; compact?: boolean }) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  const onHost = hint.fix.where === "host";
  const Icon = onHost ? Server : SlidersHorizontal;
  const script = hint.fix.commands.join("\n");

  return (
    <div className={`rounded-md border border-warn/40 bg-warn/5 text-left ${compact ? "p-2.5" : "p-3"}`}>
      <p className="whitespace-pre-line text-sm">{hint.reason}</p>
      {hint.fix.commands.length > 0 && (
        <>
          <div className="mt-2 flex items-center justify-between gap-2">
            <span className="flex items-center gap-1.5 text-xs font-medium text-subtle">
              <Icon className="size-3.5" aria-hidden />
              {onHost ? t("permissions.box.host") : t("permissions.box.panel")}
            </span>
            <button
              type="button"
              className="flex items-center gap-1 rounded border border-line px-1.5 py-0.5 text-xs text-subtle transition-colors hover:text-brand"
              onClick={async () => setCopied(await copyText(script))}
            >
              <Copy className="size-3" aria-hidden />
              {copied ? t("permissions.box.copied") : t("permissions.box.copy")}
            </button>
          </div>
          <pre className="mt-1.5 select-all overflow-x-auto rounded bg-canvas p-2 font-mono text-xs">{script}</pre>
        </>
      )}
    </div>
  );
}
