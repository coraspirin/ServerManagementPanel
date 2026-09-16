"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, Globe, Link2, Network as NetworkIcon } from "lucide-react";

import {
  buildNetworkGraph,
  type GraphContainer,
  type GraphNetwork,
  type GraphNode,
} from "@/lib/docker/netgraph";
import { useT } from "@/lib/i18n/client";
import { Rich } from "@/lib/i18n/rich";
import type { MessageKey } from "@/lib/i18n/translate";

/**
 * Ağ haritası (M3.25).
 *
 * "Hangi servis hangi ağda ve kim kiminle konuşabilir" sorusunun görsel
 * cevabı. Veri panelde zaten vardı ama hiçbir ekran bunu bir arada
 * göstermiyordu; passbolt olayında container'ın HİÇBİR ağa bağlı olmadığını
 * anlamak için sunucuda `docker inspect` çalıştırmak gerekti.
 *
 * Çizim el yazması SVG değil, KUTU DÜZENİ. Bir kuvvet-yönlü graf çizimi güzel
 * görünür ama okunması zordur ve her yenilemede düğümler yer değiştirir;
 * "passbolt hangi ağda?" sorusunu cevaplamak için ağları kutu, container'ları
 * o kutunun içindeki etiket olarak göstermek hem daha okunur hem de yeni bir
 * bağımlılık gerektirmiyor (panelde grafik kütüphanesi yok — MetricChart da
 * elle yazılmış).
 */
export function NetworkGraph({
  networks,
  containers,
  onSelect,
}: {
  networks: GraphNetwork[];
  containers: GraphContainer[];
  onSelect?: (name: string) => void;
}) {
  const t = useT();
  const [vurgu, setVurgu] = useState<string | null>(null);

  const graph = useMemo(
    () => buildNetworkGraph(networks, containers),
    [networks, containers],
  );

  const yalnizlar = graph.loose.filter((node) => node.kind === "yalniz");

  return (
    <div className="space-y-4">
      {yalnizlar.length > 0 && (
        <div className="flex items-start gap-2 rounded-lg border border-danger/40 bg-danger/10 px-4 py-3 text-sm text-danger">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>
            <strong>
              {t("docker.graph.isolated", {
                count: yalnizlar.length,
                names: yalnizlar.map((node) => node.name).join(", "),
              })}
            </strong>
            <Rich
              text={t("docker.graph.isolatedDetail")}
              values={{ cmd: <code className="font-mono">compose up</code> }}
            />
          </span>
        </div>
      )}

      <p className="text-xs text-subtle">
        <Rich
          text={t("docker.graph.intro")}
          values={{ strong: <strong>{t("docker.graph.introStrong")}</strong> }}
        />
      </p>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {graph.networks.map((network) => {
          const iceriyor = vurgu !== null && network.members.some((m) => m.name === vurgu);

          return (
            <section
              key={network.name}
              className={`rounded-lg border bg-surface px-3 py-2.5 transition-colors ${
                iceriyor ? "border-brand" : "border-line"
              }`}
            >
              <div className="mb-2 flex flex-wrap items-baseline justify-between gap-1.5">
                <h3 className="flex items-center gap-1.5 text-sm font-semibold">
                  <NetworkIcon className="size-3.5 text-subtle" aria-hidden />
                  <span className="font-mono">{network.name}</span>
                </h3>
                <span className="text-[10px] text-subtle">
                  {network.driver}
                  {network.composeProject && ` · ${network.composeProject}`}
                </span>
              </div>

              {network.members.length === 0 ? (
                <p className="text-xs text-subtle">
                  {t("docker.graph.emptyNetwork")}
                </p>
              ) : (
                <ul className="flex flex-wrap gap-1">
                  {network.members.map((member) => (
                    <Dugum
                      key={member.name}
                      node={member}
                      vurgulu={vurgu === member.name}
                      onHover={setVurgu}
                      onSelect={onSelect}
                    />
                  ))}
                </ul>
              )}
            </section>
          );
        })}
      </div>

      {graph.loose.length > 0 && (
        <section className="rounded-lg border border-line bg-surface px-3 py-2.5">
          <h3 className="mb-2 text-sm font-semibold">{t("docker.graph.loose")}</h3>
          <ul className="flex flex-wrap gap-1">
            {graph.loose.map((node) => (
              <Dugum
                key={node.name}
                node={node}
                vurgulu={vurgu === node.name}
                onHover={setVurgu}
                onSelect={onSelect}
              />
            ))}
          </ul>
          <p className="mt-2 text-[11px] text-subtle">
            <Rich
              text={t("docker.graph.legend")}
              values={{
                host: <strong>{t("docker.graph.kind.host")}</strong>,
                shared: <strong>{t("docker.graph.kind.paylasan")}</strong>,
                isolated: <strong>{t("docker.graph.kind.yalniz")}</strong>,
              }}
            />
          </p>
        </section>
      )}
    </div>
  );
}

const KIND_STYLE: Record<GraphNode["kind"], { label: MessageKey | null; className: string }> = {
  bagli: { label: null, className: "border-line" },
  host: { label: "docker.graph.kind.host", className: "border-warn/50 text-warn" },
  paylasan: { label: "docker.graph.kind.paylasan", className: "border-warn/50 text-warn" },
  yalniz: { label: "docker.graph.kind.yalniz", className: "border-danger/50 text-danger" },
};

function Dugum({
  node,
  vurgulu,
  onHover,
  onSelect,
}: {
  node: GraphNode;
  vurgulu: boolean;
  onHover: (name: string | null) => void;
  onSelect?: (name: string) => void;
}) {
  const t = useT();
  const stil = KIND_STYLE[node.kind];
  const duruyor = node.state !== "running";

  return (
    <li>
      <button
        type="button"
        onMouseEnter={() => onHover(node.name)}
        onMouseLeave={() => onHover(null)}
        onFocus={() => onHover(node.name)}
        onBlur={() => onHover(null)}
        onClick={() => onSelect?.(node.name)}
        title={
          node.networks.length > 0
            ? t("docker.graph.networks", { list: node.networks.join(", ") })
            : t("docker.graph.noNetwork")
        }
        className={`flex items-center gap-1 rounded border px-1.5 py-0.5 font-mono text-[11px] transition-colors ${
          stil.className
        } ${vurgulu ? "bg-brand/15 ring-1 ring-brand" : ""} ${
          duruyor ? "opacity-50" : ""
        } ${onSelect ? "hover:border-brand" : "cursor-default"}`}
      >
        {node.kind === "host" && <Globe className="size-3" aria-hidden />}
        {node.kind === "paylasan" && <Link2 className="size-3" aria-hidden />}
        {node.kind === "yalniz" && <AlertTriangle className="size-3" aria-hidden />}
        {node.name}
        {stil.label && <span className="text-[9px] opacity-80">{t(stil.label)}</span>}
        {duruyor && <span className="text-[9px] opacity-80">{t("docker.graph.stopped")}</span>}
      </button>
    </li>
  );
}
