"use client";

import { useCallback, useMemo, useState } from "react";
import {
  AlertTriangle,
  Container,
  Cpu,
  Globe,
  Lock,
  RotateCw,
  Search,
  Server,
  Waypoints,
} from "lucide-react";

import type { PortOwner } from "@/lib/security/portmap";
import {
  dockerPublishedPorts,
  freePorts,
  portConflicts,
  reservedPorts,
  type ListeningPort,
} from "@/lib/security/portmap";
import type { CachedPortScan } from "@/lib/security/ports";
import { fold } from "@/lib/text";
import { useFormat, useT } from "@/lib/i18n/client";
import { Rich } from "@/lib/i18n/rich";

/**
 * M3.17 — port haritası.
 *
 * İki soruyu cevaplıyor: "bu portu kim tutuyor" ve "yeni container'a hangi
 * portu vereyim". İkincisi bu ekranın var oluş sebebi — birincisi Güvenlik
 * ekranında zaten vardı ama sahibi `docker-proxy` diye görünüyordu, ki bu
 * kimseye bir şey anlatmıyor.
 *
 * RİSK DAMGASI VURULMUYOR (M3.7'den devralınan kural): "0.0.0.0'a bağlı" bir
 * bilgidir, "tehlikeli" bir yargıdır. Renk yalnızca "dışarı açık / yalnızca
 * yerel" ayrımını anlatıyor.
 */

/** Önbellek yaşı — tazeliği gizlenen veri yanlış veriden tehlikelidir (M1.10). */

export function PortsScreen({ initial }: { initial: CachedPortScan }) {
  const t = useT();
  const f = useFormat();
  const [scan, setScan] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [from, setFrom] = useState(8000);
  const [to, setTo] = useState(9999);

  const refresh = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/ports?refresh=1", { cache: "no-store" });
      if (!response.ok) throw new Error("istek reddedildi");
      setScan((await response.json()) as CachedPortScan);
    } catch {
      setError(t("ports.scanFailed"));
    } finally {
      setBusy(false);
    }
  }, [t]);

  const reserved = useMemo(
    () => reservedPorts(scan.ports, scan.containers),
    [scan.ports, scan.containers],
  );
  const conflicts = useMemo(
    () => portConflicts(scan.ports, scan.containers, t),
    [scan.ports, scan.containers, t],
  );
  const published = useMemo(() => dockerPublishedPorts(scan.containers), [scan.containers]);
  const suggestions = useMemo(() => freePorts(reserved, from, to, 10), [reserved, from, to]);

  const rows = useMemo(() => {
    const needle = fold(query.trim());
    if (!needle) return scan.ports;
    return scan.ports.filter((row) =>
      fold(`${row.port} ${row.address} ${row.owner.name} ${row.process} ${row.owner.composeProject ?? ""}`).includes(needle),
    );
  }, [scan.ports, query]);

  const exposed = scan.ports.filter((row) => row.wildcard);

  return (
    <div className="space-y-6">
      {error && (
        <p className="rounded-lg border border-danger/40 bg-danger/10 px-4 py-2 text-sm text-danger">
          {error}
        </p>
      )}

      {/* --- Boş port bulucu: ekranın var oluş sebebi --- */}
      <section className="rounded-lg border border-line bg-surface">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <Waypoints className="size-4 text-subtle" aria-hidden />
            {t("ports.findFree")}
          </h2>
          <span className="text-xs text-subtle">
            {t("ports.dataAge", {
              age:
                scan.updatedAt === null
                  ? t("ports.neverScanned")
                  : f.relative(scan.updatedAt * 1000),
              count: scan.ports.length,
            })}
          </span>
        </div>

        <div className="space-y-3 px-5 py-4">
          <div className="flex flex-wrap items-end gap-3">
            <label className="text-xs text-subtle">
              {t("ports.rangeStart")}
              <input
                type="number"
                value={from}
                onChange={(event) => setFrom(Number(event.target.value))}
                className="mt-1 block w-28 rounded-md border border-line bg-bg px-2 py-1.5 font-mono text-sm"
              />
            </label>
            <label className="text-xs text-subtle">
              {t("ports.rangeEnd")}
              <input
                type="number"
                value={to}
                onChange={(event) => setTo(Number(event.target.value))}
                className="mt-1 block w-28 rounded-md border border-line bg-bg px-2 py-1.5 font-mono text-sm"
              />
            </label>
            <button
              type="button"
              onClick={() => void refresh()}
              disabled={busy}
              className="flex items-center gap-1.5 rounded-md border border-line px-3 py-1.5 text-sm transition-colors hover:border-brand disabled:opacity-50"
            >
              <RotateCw className={`size-4 ${busy ? "animate-spin" : ""}`} />
              {scan.updatedAt === null ? t("ports.scan") : t("common.actions.refresh")}
            </button>
          </div>

          {scan.updatedAt === null ? (
            <p className="text-sm text-subtle">
              {t("ports.notScanned")}
            </p>
          ) : suggestions.length === 0 ? (
            <p className="text-sm text-warn">{t("ports.noFree")}</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {suggestions.map((port) => (
                <span
                  key={port}
                  className="rounded-md border border-ok/40 bg-ok/10 px-2.5 py-1 font-mono text-sm tabular-nums text-ok"
                >
                  {port}
                </span>
              ))}
            </div>
          )}

          <p className="text-xs text-subtle">
            <Rich
              text={t("ports.busyNote")}
              values={{ strong: <strong>{t("ports.busyNoteStrong")}</strong> }}
            />
          </p>
        </div>
      </section>

      {/* --- Çakışmalar: yalnızca gerçekten patlayacak olanlar --- */}
      {conflicts.length > 0 && (
        <section className="rounded-lg border border-warn/40 bg-warn/5">
          <h2 className="flex items-center gap-2 border-b border-warn/30 px-5 py-3 text-sm font-semibold text-warn">
            <AlertTriangle className="size-4" aria-hidden />
            {t("ports.conflicts", { count: conflicts.length })}
          </h2>
          <ul className="space-y-1.5 px-5 py-3 text-sm">
            {conflicts.map((conflict, index) => (
              <li key={`${conflict.port}-${index}`} className="flex gap-2">
                <span className="font-mono text-xs tabular-nums text-subtle">{conflict.port}</span>
                <span>{conflict.message}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* --- Sahiplik tablosu --- */}
      <section className="rounded-lg border border-line bg-surface">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <Server className="size-4 text-subtle" aria-hidden />
            {t("ports.owners")}
            <span className="font-normal text-subtle">
              {t("ports.ownersMeta", { count: rows.length, exposed: exposed.length })}
            </span>
          </h2>
          <label className="flex items-center gap-1.5 rounded-md border border-line px-2 py-1">
            <Search className="size-3.5 text-subtle" aria-hidden />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("ports.search")}
              className="w-44 bg-transparent text-sm outline-none"
            />
          </label>
        </div>

        {scan.error ? (
          <p className="px-5 py-6 text-sm text-danger">{scan.error}</p>
        ) : rows.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-subtle">
            {scan.updatedAt === null ? t("ports.useButton") : t("ports.noMatch")}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="rtable w-full min-w-[46rem] text-sm">
              <thead className="border-b border-line text-left text-xs text-subtle">
                <tr>
                  <th className="px-5 py-2 font-medium">{t("proxy.form.port")}</th>
                  <th className="px-4 py-2 font-medium">{t("ports.col.protocol")}</th>
                  <th className="px-4 py-2 font-medium">{t("ports.col.address")}</th>
                  <th className="px-4 py-2 font-medium">{t("ports.col.owner")}</th>
                  <th className="px-4 py-2 font-medium">{t("ports.col.process")}</th>
                  <th className="px-4 py-2 font-medium">{t("ports.col.scope")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((row, index) => (
                  <PortRow
                    key={`${row.protocol}-${row.address}-${row.port}-${index}`}
                    port={row}
                    dockerPublished={published.has(row.port)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function OwnerCell({ owner, dockerPublished }: { owner: PortOwner; dockerPublished: boolean }) {
  const t = useT();
  if (owner.kind === "container") {
    return (
      <span className="flex flex-wrap items-center gap-1.5">
        <Container className="size-3.5 text-subtle" aria-hidden />
        <span>{owner.name || `container ${owner.containerId}`}</span>
        {owner.composeProject && (
          <span className="rounded border border-line px-1 text-[10px] text-subtle">
            {owner.composeProject}
          </span>
        )}
        {dockerPublished && (
          <span
            className="rounded border border-warn/40 px-1 text-[10px] text-warn"
            title={t("ports.publishedTitle")}
          >
            {t("ports.published")}
          </span>
        )}
      </span>
    );
  }

  if (owner.kind === "service") {
    return (
      <span className="flex items-center gap-1.5">
        <Cpu className="size-3.5 text-subtle" aria-hidden />
        {owner.name}
      </span>
    );
  }

  return <span className="text-subtle">{owner.name || "—"}</span>;
}

function PortRow({
  port,
  dockerPublished,
}: {
  port: ListeningPort;
  dockerPublished: boolean;
}) {
  const t = useT();
  return (
    <tr className="hover:bg-line/30">
      <td data-label={t("proxy.form.port")} className="px-5 py-1.5 font-mono text-xs tabular-nums">
        {port.port}
      </td>
      <td data-label={t("ports.col.protocol")} className="px-4 py-1.5 text-xs text-subtle">{port.protocol}</td>
      <td data-label={t("ports.col.address")} className="px-4 py-1.5 font-mono text-xs">{port.address}</td>
      <td data-label={t("ports.col.owner")} className="px-4 py-1.5 text-xs">
        <OwnerCell owner={port.owner} dockerPublished={dockerPublished} />
      </td>
      <td data-label={t("ports.col.process")} className="px-4 py-1.5 text-xs text-subtle">
        {port.process || "—"}
        {port.pid !== null && <span className="ml-1">({port.pid})</span>}
      </td>
      <td data-label={t("ports.col.scope")} className="px-4 py-1.5">
        {port.wildcard ? (
          <span className="flex items-center gap-1 text-xs text-warn">
            <Globe className="size-3" aria-hidden /> {t("ports.allInterfaces")}
          </span>
        ) : port.loopback ? (
          <span className="flex items-center gap-1 text-xs text-ok">
            <Lock className="size-3" aria-hidden /> {t("ports.localOnly")}
          </span>
        ) : (
          <span className="text-xs text-subtle">{t("ports.singleInterface")}</span>
        )}
      </td>
    </tr>
  );
}
