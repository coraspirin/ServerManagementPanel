"use client";

import { useMemo, useState } from "react";
import { Check, Copy } from "lucide-react";

import { Section } from "./shared";
import { useFormat, useT } from "@/lib/i18n/client";
import { Rich } from "@/lib/i18n/rich";

/**
 * Ham `docker inspect` çıktısı (M3.20).
 *
 * Veri M1.8'den beri `/detail` yanıtında geliyordu ama arayüzde bir
 * `<details>` katlamasının içindeydi. Panelin yorumlamadığı her şey burada;
 * bir sorunu teşhis ederken en çok bakılan yer olduğu için kendi sekmesini
 * ve bir aramayı hak ediyor.
 */
export function InspectTab({ raw }: { raw: unknown }) {
  const t = useT();
  const f = useFormat();
  const [filter, setFilter] = useState("");
  const [copied, setCopied] = useState(false);

  const text = useMemo(() => JSON.stringify(raw, null, 2), [raw]);

  const lines = useMemo(() => {
    const all = text.split("\n");
    const query = f.lower(filter.trim());
    if (!query) return all;
    return all.filter((line) => f.lower(line).includes(query));
  }, [text, filter, f]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Pano izni yoksa sessiz kal; metin zaten ekranda seçilebilir durumda.
    }
  }

  return (
    <Section
      title={t("docker.inspect.title")}
      action={
        <button
          type="button"
          onClick={() => void copy()}
          className="flex items-center gap-1 text-xs text-subtle transition-colors hover:text-brand"
        >
          {copied ? <Check className="size-3.5 text-ok" /> : <Copy className="size-3.5" />}
          {copied ? t("docker.inspect.copied") : t("docker.inspect.copy")}
        </button>
      }
    >
      <input
        type="search"
        value={filter}
        onChange={(event) => setFilter(event.target.value)}
        placeholder={t("docker.inspect.filter")}
        className="mb-2 w-full rounded-md border border-line bg-canvas px-2.5 py-1.5 text-sm outline-none focus:border-brand"
      />

      {filter.trim() && (
        <p className="mb-1.5 text-[11px] text-subtle">
          <Rich
            text={t("docker.inspect.matched", { count: lines.length })}
            values={{ strong: <strong>{t("docker.inspect.lineFilter")}</strong> }}
          />
        </p>
      )}

      <pre className="max-h-[28rem] overflow-auto rounded border border-line bg-canvas p-2 font-mono text-[10px] leading-relaxed">
        {lines.join("\n")}
      </pre>
    </Section>
  );
}
