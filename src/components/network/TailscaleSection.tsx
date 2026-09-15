import { KeyRound, Router, Shield, Waypoints } from "lucide-react";
import type { Peer, TailscaleStatus } from "@/lib/tailscale/status";

/**
 * M2.10 — tailnet durumu.
 *
 * Ağ ekranının içinde: kullanıcı için "hangi cihazlar bana ulaşabiliyor"
 * sorusunun LAN ve tailnet cevapları aynı sorunun iki yüzü.
 */

function formatAgo(ts: number | null): string {
  if (!ts) return "—";
  const seconds = Math.max(0, Math.floor(Date.now() / 1000) - ts);
  if (seconds < 90) return "az önce";
  if (seconds < 3600) return `${Math.round(seconds / 60)} dk önce`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)} sa önce`;
  return `${Math.round(seconds / 86400)} gün önce`;
}

function expiryTone(peer: Peer): { text: string; className: string } {
  if (peer.keyExpiryDisabled) return { text: "anahtar süresiz", className: "text-subtle" };
  const days = peer.daysToExpiry ?? 0;
  if (days < 0) return { text: `anahtar ${-days} gün önce doldu`, className: "text-danger" };
  if (days <= 14) return { text: `anahtar ${days} gün sonra`, className: "text-warn" };
  return { text: `anahtar ${days} gün sonra`, className: "text-subtle" };
}

function PeerRow({ peer }: { peer: Peer }) {
  const expiry = expiryTone(peer);

  return (
    <li className="flex flex-wrap items-center gap-3 px-3 py-2.5">
      <span
        aria-hidden
        title={peer.online ? "çevrimiçi" : "çevrimdışı"}
        className={`size-2 shrink-0 rounded-full ${peer.online ? "bg-ok" : "bg-line"}`}
      />
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-2">
          <span className="truncate text-sm font-medium">{peer.hostname}</span>
          <span className="text-[11px] text-subtle">{peer.os}</span>
          {peer.exitNode && (
            <span className="flex items-center gap-1 rounded bg-brand/10 px-1 text-[10px] text-brand">
              <Shield className="size-3" /> çıkış düğümü
            </span>
          )}
          {peer.subnetRouter && (
            <span className="flex items-center gap-1 rounded bg-brand/10 px-1 text-[10px] text-brand">
              <Router className="size-3" /> ağ yönlendirici
            </span>
          )}
          {peer.online && !peer.direct && (
            // Röle üzerinden giden trafiğin gecikmesi belirgin şekilde yüksek;
            // "bağlı ama yavaş" durumunu görünür kılmak gerekiyor.
            <span
              title="Trafik DERP rölesi üzerinden gidiyor — doğrudan bağlantı kurulamadı"
              className="flex items-center gap-1 rounded bg-warn/15 px-1 text-[10px] text-warn"
            >
              <Waypoints className="size-3" /> röle{peer.relay && ` (${peer.relay})`}
            </span>
          )}
        </span>
        <span className="block truncate font-mono text-[11px] text-subtle">
          {peer.ip}
          {peer.dnsName && ` · ${peer.dnsName}`}
        </span>
        {!peer.online && (
          <span className="block text-[11px] text-subtle">
            son görülme {formatAgo(peer.lastSeen)}
          </span>
        )}
      </span>
      <span className={`flex shrink-0 items-center gap-1 text-xs ${expiry.className}`}>
        <KeyRound className="size-3.5" aria-hidden />
        {expiry.text}
      </span>
    </li>
  );
}

export function TailscaleSection({ status }: { status: TailscaleStatus }) {
  return (
    <section className="rounded-lg border border-line bg-surface p-5">
      <h2 className="text-sm font-semibold">
        Tailscale
        {status.available && (
          <span className="ml-2 font-normal text-subtle">
            {status.peers.length + (status.self ? 1 : 0)} düğüm · {status.backendState}
          </span>
        )}
      </h2>

      {!status.available ? (
        <p className="mt-2 text-sm text-subtle">{status.error ?? "tailscaled erişilemiyor."}</p>
      ) : (
        <>
          <p className="mt-1 text-xs text-subtle">
            {status.magicDns && `MagicDNS: ${status.magicDns} · `}
            sürüm {status.version}
            {status.expiring.length > 0 && (
              <span className="text-warn">
                {" · "}
                {status.expiring.length} düğümün anahtarı yakında doluyor
              </span>
            )}
          </p>

          <ul className="mt-4 divide-y divide-line rounded-md border border-line">
            {status.self && <PeerRow peer={status.self} />}
            {status.peers.map((peer) => (
              <PeerRow key={peer.id} peer={peer} />
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
