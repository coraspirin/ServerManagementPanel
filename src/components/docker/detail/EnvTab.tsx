"use client";

import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";

import { isSecretName } from "@/lib/text";

import { Section } from "./shared";

/**
 * Ortam değişkenleri — sır taşıyan değerler VARSAYILAN OLARAK maskeli.
 *
 * Öncesinde hepsi düz metin basılıyordu ve üstünde "parola içerebilir" diyen
 * bir uyarı vardı. Uyarı maskeleme değildir: bu ekran omuz üstünden okunabilir,
 * ekran görüntüsü alınabilir, sunum sırasında yansıtılabilir. M1.8 sırasında
 * gerçek sunucuda Pi-hole'un `WEBPASSWORD` değeri düpedüz ekrandaydı.
 *
 * Ada bakılıyor, değere değil (bkz. `isSecretName`) — ve ölçüt eksik
 * yakalayabileceği için uyarı metni de KALIYOR.
 *
 * M3.20'de `<details>` içinden çıkıp kendi sekmesine taşındı: 40 değişkenli bir
 * container'da açılıp kapanan bir kutu, aranabilir bir liste değildi.
 */
export function EnvTab({ env }: { env: { key: string; value: string }[] }) {
  const [shown, setShown] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState("");

  const secrets = env.filter((entry) => isSecretName(entry.key)).length;
  const query = filter.trim().toLowerCase();
  const filtered = query
    ? env.filter(
        (entry) =>
          entry.key.toLowerCase().includes(query) || entry.value.toLowerCase().includes(query),
      )
    : env;

  const toggle = (key: string) =>
    setShown((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  if (env.length === 0) {
    return (
      <Section title="Ortam değişkenleri">
        <p className="text-sm text-subtle">Tanımlı ortam değişkeni yok.</p>
      </Section>
    );
  }

  return (
    <Section
      title={`Ortam değişkenleri (${env.length})`}
      action={
        secrets > 0 ? (
          <span className="text-xs text-warn">{secrets} tanesi maskeli</span>
        ) : null
      }
    >
      <input
        type="search"
        value={filter}
        onChange={(event) => setFilter(event.target.value)}
        placeholder="ada ya da değere göre ara…"
        className="mb-2 w-full rounded-md border border-line bg-canvas px-2.5 py-1.5 text-sm outline-none focus:border-brand"
      />

      <p className="mb-2 text-[11px] text-warn">
        Maskeleme değişken <strong>adına</strong> bakar; adı ele vermeyen bir değer de parola
        olabilir.
      </p>

      {filtered.length === 0 ? (
        <p className="text-sm text-subtle">Eşleşen değişken yok.</p>
      ) : (
        <ul className="space-y-0.5 break-all font-mono text-[11px]">
          {filtered.map((entry) => {
            const sirli = isSecretName(entry.key);
            const gizli = sirli && !shown.has(entry.key);

            return (
              <li key={entry.key} className="flex items-start gap-1.5">
                <span className="min-w-0 flex-1">
                  <span className="text-subtle">{entry.key}=</span>
                  {gizli ? <span className="text-subtle">••••••••</span> : entry.value}
                </span>

                {sirli && (
                  <button
                    type="button"
                    onClick={() => toggle(entry.key)}
                    title={gizli ? "Göster" : "Gizle"}
                    className="shrink-0 text-subtle transition-colors hover:text-brand"
                  >
                    {gizli ? <Eye className="size-3.5" /> : <EyeOff className="size-3.5" />}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <p className="mt-3 text-xs text-subtle">
        Buradaki değerler <strong>çalışan container&apos;a ait</strong>. Kalıcı olarak
        değiştirmek için Compose sekmesini kullan — burada yapılacak bir değişikliği ilk{" "}
        <code className="font-mono">compose up</code> geri alırdı.
      </p>
    </Section>
  );
}
