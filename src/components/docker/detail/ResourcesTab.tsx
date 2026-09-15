"use client";

import { useCallback, useEffect, useState } from "react";
import { RotateCw } from "lucide-react";

import { CHART_PALETTE, MetricChart } from "@/components/metrics/MetricChart";
import { RANGES, type RangeId, type Series, type SeriesResult } from "@/lib/metrics/catalog";
import { countersToRates } from "@/lib/metrics/rates";

import { Section } from "./shared";

/**
 * Container başına kaynak grafikleri (M3.22).
 *
 * Veri M1.6'dan beri toplanıyordu: `collectDockerMetrics` her turda
 * `docker.cpu_pct`, `docker.mem_used`, `docker.mem_pct` değerlerini container
 * ADINI etiket olarak kullanarak `metrics_raw`'a yazıyor ve T1'in rollup,
 * budama ve grafik makinesi bunları olduğu gibi işliyordu. Eksik olan tek şey
 * çizimdi — panel kendi topladığı veriyi göstermiyordu.
 *
 * Ağ ve disk sayaçları M3.22'de eklendi ve KÜMÜLATİF yazılıyor; hıza çevirme
 * `countersToRates` ile burada yapılıyor (sayaç sıfırlanması dahil).
 *
 * Etiket container ADI, kimliği değil: metrikler adla yazıldığı için bir
 * container yeniden yaratıldığında (aynı adla) geçmişi kopmuyor.
 */
export function ResourcesTab({ containerName }: { containerName: string }) {
  const [range, setRange] = useState<RangeId>("6h");
  const [data, setData] = useState<SeriesResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const url = `/api/metrics/series?metrics=${METRICS.join(",")}&range=${range}&label=${encodeURIComponent(containerName)}`;

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const response = await fetch(url, { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) {
        setError(payload.error ?? "Ölçümler okunamadı.");
        return;
      }
      setError(null);
      setData(payload as SeriesResult);
    } catch {
      setError("Sunucuya ulaşılamadı.");
    } finally {
      setBusy(false);
    }
  }, [url]);

  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      try {
        const response = await fetch(url, { cache: "no-store", signal: controller.signal });
        const payload = await response.json();
        if (!response.ok) setError(payload.error ?? "Ölçümler okunamadı.");
        else {
          setError(null);
          setData(payload as SeriesResult);
        }
      } catch (fetchError) {
        if ((fetchError as Error)?.name !== "AbortError") setError("Sunucuya ulaşılamadı.");
      }
    })();
    return () => controller.abort();
  }, [url]);

  if (error) {
    return (
      <Section title="Kaynak kullanımı">
        <p className="text-sm text-danger">{error}</p>
      </Section>
    );
  }

  if (!data) {
    return (
      <Section title="Kaynak kullanımı">
        <p className="text-sm text-subtle">yükleniyor…</p>
      </Section>
    );
  }

  const al = (metric: string) => data.series.filter((entry) => entry.metric === metric);

  const cpu = al("docker.cpu_pct");
  const bellek = al("docker.mem_used");
  const ag = countersToRates([...al("docker.net_rx"), ...al("docker.net_tx")]);
  const disk = countersToRates([...al("docker.blk_read"), ...al("docker.blk_write")]);

  const bosMu = [cpu, bellek, ag, disk].every((entry) => noktaSayisi(entry) === 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-1">
          {RANGES.map((entry) => (
            <button
              key={entry.id}
              type="button"
              onClick={() => setRange(entry.id)}
              className={`rounded-md border px-2.5 py-1 text-xs transition-colors ${
                range === entry.id
                  ? "border-brand bg-brand/10 font-medium text-brand"
                  : "border-line text-subtle hover:text-ink"
              }`}
            >
              {entry.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2 text-xs text-subtle">
          <span>{data.tier}</span>
          <button
            type="button"
            onClick={() => void load()}
            disabled={busy}
            title="Yenile"
            className="rounded border border-line p-1.5 transition-colors hover:text-brand disabled:opacity-50"
          >
            <RotateCw className={`size-3.5 ${busy ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      {bosMu ? (
        <Section title="Kaynak kullanımı">
          <p className="text-sm text-subtle">
            Bu aralıkta ölçüm yok. Ölçümler yalnızca container <strong>çalışırken</strong>{" "}
            toplanıyor; durmuş bir container için daha geniş bir aralık seçersen son çalıştığı
            döneme ait veriyi görebilirsin.
          </p>
        </Section>
      ) : (
        <>
          <Grafik
            title="CPU"
            series={cpu}
            names={["CPU"]}
            format="pct"
            fixedMax={100}
            from={data.from}
            to={data.to}
            showBand={data.tier !== "ham"}
          />
          <Grafik
            title="Bellek"
            series={bellek}
            names={["kullanılan"]}
            format="bytes"
            from={data.from}
            to={data.to}
            showBand={data.tier !== "ham"}
          />
          <Grafik
            title="Ağ"
            series={ag}
            names={["giriş", "çıkış"]}
            format="bps"
            from={data.from}
            to={data.to}
            showBand={false}
          />
          <Grafik
            title="Disk"
            series={disk}
            names={["okuma", "yazma"]}
            format="bps"
            from={data.from}
            to={data.to}
            showBand={false}
          />
        </>
      )}
    </div>
  );
}

const METRICS = [
  "docker.cpu_pct",
  "docker.mem_used",
  "docker.net_rx",
  "docker.net_tx",
  "docker.blk_read",
  "docker.blk_write",
];

function noktaSayisi(series: Series[]): number {
  return series.reduce((total, entry) => total + entry.points.length, 0);
}

function Grafik({
  title,
  series,
  names,
  format,
  fixedMax,
  showBand,
  from,
  to,
}: {
  title: string;
  series: Series[];
  names: string[];
  format: React.ComponentProps<typeof MetricChart>["format"];
  fixedMax?: number;
  showBand: boolean;
  from: number;
  to: number;
}) {
  if (noktaSayisi(series) === 0) return null;

  return (
    <section className="rounded-lg border border-line bg-surface px-4 py-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold">{title}</h3>
        <div className="flex flex-wrap gap-3">
          {names.slice(0, series.length).map((name, index) => (
            <span key={name} className="flex items-center gap-1.5 text-xs text-subtle">
              <span
                className="size-2 rounded-full"
                style={{ backgroundColor: CHART_PALETTE[index % CHART_PALETTE.length] }}
              />
              {name}
            </span>
          ))}
        </div>
      </div>
      <div className="mt-3">
        <MetricChart
          series={series}
          names={names}
          format={format}
          fixedMax={fixedMax}
          showBand={showBand}
          from={from}
          to={to}
          height={150}
        />
      </div>
    </section>
  );
}
