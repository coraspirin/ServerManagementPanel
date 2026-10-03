"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { CheckCheck } from "lucide-react";
import { CSRF_COOKIE, CSRF_HEADER } from "@/lib/auth/types";
import { useT } from "@/lib/i18n/client";

function readCsrfToken(): string {
  const match = document.cookie.match(new RegExp(`(?:^|; )${CSRF_COOKIE}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : "";
}

/** Son olaylar widget'ındaki okunmamışları tek tıkla okundu işaretler. */
export function AckButton({ ids }: { ids: number[] }) {
  const t = useT();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [pending, startTransition] = useTransition();

  if (ids.length === 0) return null;

  return (
    <button
      type="button"
      disabled={busy || pending}
      onClick={async () => {
        setBusy(true);
        try {
          const response = await fetch("/api/events", {
            method: "POST",
            headers: { "content-type": "application/json", [CSRF_HEADER]: readCsrfToken() },
            body: JSON.stringify({ ids }),
          });
          if (response.ok) startTransition(() => router.refresh());
        } finally {
          setBusy(false);
        }
      }}
      className="flex shrink-0 items-center gap-1 text-xs text-subtle transition-colors hover:text-brand disabled:opacity-50"
    >
      <CheckCheck className="size-3.5" aria-hidden />
      {t("dashboard.events.ackAll")}
    </button>
  );
}
