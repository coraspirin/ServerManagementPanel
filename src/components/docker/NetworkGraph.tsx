"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, Globe, Link2, Network as NetworkIcon } from "lucide-react";

import {
  buildNetworkGraph,
  type GraphContainer,
  type GraphNetwork,
  type GraphNode,
} from "@/lib/docker/netgraph";

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
              {yalnizlar.length} container hiçbir ağa bağlı değil:{" "}
              {yalnizlar.map((node) => node.name).join(", ")}
            </strong>
            . Ne başka container&apos;lara ulaşabilirler, ne de yayınlanmış portları
            çalışır. Genellikle port çakışması yüzünden yarıda kalmış bir{" "}
            <code className="font-mono">compose up</code>&apos;ın izidir.
          </span>
        </div>
      )}

      <p className="text-xs text-subtle">
        Aynı kutudaki container&apos;lar birbirinin <strong>adını çözebilir</strong>; farklı
        kutulardakiler çözemez. Bir container&apos;ın üstüne gelince bulunduğu tüm ağlar
        vurgulanır.
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
                  Boş — bu ağı kimse kullanmıyor, silinebilir.
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
          <h3 className="mb-2 text-sm font-semibold">Ağ kutusuna girmeyenler</h3>
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
            <strong>host</strong>: container host&apos;un ağ yığınını doğrudan kullanıyor,
            izole değil. <strong>paylaşan</strong>: ağ yığını başka bir container&apos;a ait
            (ör. VPN container&apos;ı). <strong>ağsız</strong>: hiçbir ağda değil — bu bir
            arıza.
          </p>
        </section>
      )}
    </div>
  );
}

const KIND_STYLE: Record<GraphNode["kind"], { label: string; className: string }> = {
  bagli: { label: "", className: "border-line" },
  host: { label: "host", className: "border-warn/50 text-warn" },
  paylasan: { label: "paylaşan", className: "border-warn/50 text-warn" },
  yalniz: { label: "ağsız", className: "border-danger/50 text-danger" },
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
            ? `Ağlar: ${node.networks.join(", ")}`
            : "Hiçbir ağa bağlı değil"
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
        {stil.label && <span className="text-[9px] opacity-80">{stil.label}</span>}
        {duruyor && <span className="text-[9px] opacity-80">durmuş</span>}
      </button>
    </li>
  );
}
