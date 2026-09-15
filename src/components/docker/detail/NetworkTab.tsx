"use client";

import Link from "next/link";
import { AlertTriangle } from "lucide-react";

import type { ContainerDetail } from "@/lib/providers/types";

import { Row, Section } from "./shared";
import { useListeningPorts } from "./useDetail";

/**
 * Ağ sekmesi (M3.20).
 *
 * Ağ modu ve ağ listesi eskiden "Yapılandırma" başlığı altında image ve
 * mount'larla aynı kutudaydı. Passbolt olayında (bkz. M3.21) sorun tam olarak
 * buradaydı — container hiçbir ağa bağlı değildi — ama bilgi üç satır aşağıda,
 * fark edilmeyecek bir yerde duruyordu.
 */
export function NetworkTab({ detail }: { detail: ContainerDetail }) {
  const listening = useListeningPorts(true);

  // `network_mode: container:<id>` ağ yığınını başka bir container'a devreder;
  // o container durursa bu da ağsız kalır. Sık rastlanmayan ama teşhisi zor
  // bir bağımlılık, açıkça söylenmeyi hak ediyor.
  const paylasilan = detail.networkMode.startsWith("container:");
  const host = detail.networkMode === "host";

  return (
    <div className="space-y-5">
      {detail.networks.length === 0 && !host && !paylasilan && (
        <div className="flex items-start gap-2 rounded-lg border border-danger/40 bg-danger/10 px-4 py-3 text-sm text-danger">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>
            <strong>Bu container hiçbir ağa bağlı değil.</strong> Ne başka container&apos;lara
            ulaşabilir, ne de yayınlanmış portları çalışır. Genellikle{" "}
            <code className="font-mono">compose up</code> sırasında port ayrılamadığı için
            yarım kalmış bir başlatmanın izidir.
          </span>
        </div>
      )}

      <Section title="Ağ">
        <dl className="space-y-1.5 text-sm">
          <Row label="Ağ modu">
            <span className="font-mono text-[11px]">{detail.networkMode}</span>
            {host && (
              <span className="ml-2 text-xs text-warn">
                host ağı — port eşlemesi yok, container host&apos;un portlarını doğrudan
                kullanır
              </span>
            )}
            {paylasilan && (
              <span className="ml-2 text-xs text-warn">
                ağ yığını başka bir container&apos;a ait
              </span>
            )}
          </Row>
          <Row label="Ağlar">
            {detail.networks.length === 0 ? (
              <span className="text-subtle">—</span>
            ) : (
              <span className="flex flex-wrap gap-1.5">
                {detail.networks.map((network) => (
                  <span
                    key={network}
                    className="rounded border border-line px-1.5 py-0.5 font-mono text-[11px]"
                  >
                    {network}
                  </span>
                ))}
              </span>
            )}
          </Row>
          {detail.volumesFrom.length > 0 && (
            <Row label="volumes_from">
              <span className="font-mono text-[11px]">{detail.volumesFrom.join(", ")}</span>
            </Row>
          )}
        </dl>
      </Section>

      <Section title="Portlar">
        {detail.ports.length === 0 ? (
          <p className="text-sm text-subtle">
            Yayınlanmış port yok. Bu container&apos;a yalnızca aynı Docker ağındaki diğer
            container&apos;lar erişebilir.
          </p>
        ) : (
          <>
            <ul className="space-y-1.5">
              {detail.ports.map((port, index) => {
                const yayinli = port.hostPort !== null;
                const dinleniyor = yayinli && listening !== null && listening.has(port.hostPort!);

                return (
                  <li
                    key={`${port.hostPort}-${port.containerPort}-${port.protocol}-${index}`}
                    className="flex flex-wrap items-center gap-2 text-sm"
                  >
                    <span className="rounded border border-line px-1.5 py-0.5 font-mono text-[11px]">
                      {yayinli
                        ? `${port.hostPort}→${port.containerPort}/${port.protocol}`
                        : `${port.containerPort}/${port.protocol}`}
                    </span>

                    {!yayinli && (
                      <span className="text-xs text-subtle">yalnızca ağ içinde</span>
                    )}

                    {yayinli && listening !== null && (
                      <span className={`text-xs ${dinleniyor ? "text-ok" : "text-warn"}`}>
                        {dinleniyor
                          ? "host'ta dinleniyor"
                          : "son taramada host'ta dinlenmiyordu"}
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>

            <p className="mt-3 text-xs text-subtle">
              Docker yayınlanmış portlarda <strong>ufw&apos;yi atlar</strong> — güvenlik duvarı
              kuralı bu portları kapatmaz.{" "}
              <Link href="/firewall" className="underline underline-offset-2">
                Güvenlik duvarı
              </Link>{" "}
              ·{" "}
              <Link href="/ports" className="underline underline-offset-2">
                Port haritası
              </Link>
            </p>
          </>
        )}
      </Section>
    </div>
  );
}
