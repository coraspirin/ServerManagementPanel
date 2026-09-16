"use client";

import Link from "next/link";
import { AlertTriangle } from "lucide-react";

import type { ContainerDetail } from "@/lib/providers/types";
import { useT } from "@/lib/i18n/client";
import { Rich } from "@/lib/i18n/rich";

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
  const t = useT();
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
            <strong>{t("docker.networkTab.noNetworkTitle")}</strong>{" "}
            <Rich
              text={t("docker.networkTab.noNetwork")}
              values={{ cmd: <code className="font-mono">compose up</code> }}
            />
          </span>
        </div>
      )}

      <Section title={t("docker.networkTab.title")}>
        <dl className="space-y-1.5 text-sm">
          <Row label={t("docker.networkTab.mode")}>
            <span className="font-mono text-[11px]">{detail.networkMode}</span>
            {host && (
              <span className="ml-2 text-xs text-warn">
                {t("docker.networkTab.hostMode")}
              </span>
            )}
            {paylasilan && (
              <span className="ml-2 text-xs text-warn">
                {t("docker.networkTab.sharedMode")}
              </span>
            )}
          </Row>
          <Row label={t("docker.networkTab.networks")}>
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

      <Section title={t("docker.networkTab.ports")}>
        {detail.ports.length === 0 ? (
          <p className="text-sm text-subtle">
            {t("docker.networkTab.noPorts")}
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
                      <span className="text-xs text-subtle">{t("docker.networkTab.internalOnly")}</span>
                    )}

                    {yayinli && listening !== null && (
                      <span className={`text-xs ${dinleniyor ? "text-ok" : "text-warn"}`}>
                        {dinleniyor
                          ? t("docker.networkTab.listening")
                          : t("docker.networkTab.notListening")}
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>

            <p className="mt-3 text-xs text-subtle">
              <Rich
                text={t("docker.networkTab.ufwNote")}
                values={{ strong: <strong>{t("docker.networkTab.ufwBypass")}</strong> }}
              />{" "}
              <Link href="/firewall" className="underline underline-offset-2">
                {t("docker.networkTab.firewall")}
              </Link>{" "}
              ·{" "}
              <Link href="/ports" className="underline underline-offset-2">
                {t("docker.networkTab.portMap")}
              </Link>
            </p>
          </>
        )}
      </Section>
    </div>
  );
}
