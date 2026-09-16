import { KeyRound, Router, Shield, Waypoints } from "lucide-react";
import type { Peer, TailscaleStatus } from "@/lib/tailscale/status";
import { formatRelative } from "@/lib/i18n/format";
import { getActiveDictionary, getT } from "@/lib/i18n/server";
import type { TFunction } from "@/lib/i18n/translate";

/**
 * M2.10 — tailnet durumu.
 *
 * Ağ ekranının içinde: kullanıcı için "hangi cihazlar bana ulaşabiliyor"
 * sorusunun LAN ve tailnet cevapları aynı sorunun iki yüzü.
 */

function expiryTone(peer: Peer, t: TFunction): { text: string; className: string } {
  if (peer.keyExpiryDisabled) return { text: t("tailscale.keyNoExpiry"), className: "text-subtle" };
  const days = peer.daysToExpiry ?? 0;
  if (days < 0) return { text: t("tailscale.keyExpired", { count: -days }), className: "text-danger" };
  const text = t("tailscale.keyExpires", { count: days });
  if (days <= 14) return { text, className: "text-warn" };
  return { text, className: "text-subtle" };
}

function PeerRow({ peer }: { peer: Peer }) {
  const t = getT();
  const expiry = expiryTone(peer, t);

  return (
    <li className="flex flex-wrap items-center gap-3 px-3 py-2.5">
      <span
        aria-hidden
        title={peer.online ? t("networkScreen.online") : t("networkScreen.offline")}
        className={`size-2 shrink-0 rounded-full ${peer.online ? "bg-ok" : "bg-line"}`}
      />
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-2">
          <span className="truncate text-sm font-medium">{peer.hostname}</span>
          <span className="text-[11px] text-subtle">{peer.os}</span>
          {peer.exitNode && (
            <span className="flex items-center gap-1 rounded bg-brand/10 px-1 text-[10px] text-brand">
              <Shield className="size-3" /> {t("tailscale.exitNode")}
            </span>
          )}
          {peer.subnetRouter && (
            <span className="flex items-center gap-1 rounded bg-brand/10 px-1 text-[10px] text-brand">
              <Router className="size-3" /> {t("tailscale.subnetRouter")}
            </span>
          )}
          {peer.online && !peer.direct && (
            // Röle üzerinden giden trafiğin gecikmesi belirgin şekilde yüksek;
            // "bağlı ama yavaş" durumunu görünür kılmak gerekiyor.
            <span
              title={t("tailscale.relayTitle")}
              className="flex items-center gap-1 rounded bg-warn/15 px-1 text-[10px] text-warn"
            >
              <Waypoints className="size-3" /> {t("tailscale.relay")}
              {peer.relay && ` (${peer.relay})`}
            </span>
          )}
        </span>
        <span className="block truncate font-mono text-[11px] text-subtle">
          {peer.ip}
          {peer.dnsName && ` · ${peer.dnsName}`}
        </span>
        {!peer.online && (
          <span className="block text-[11px] text-subtle">
            {t("networkScreen.lastSeen", {
              when: peer.lastSeen ? formatRelative(peer.lastSeen * 1000, getActiveDictionary()) : "—",
            })}
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
  const t = getT();
  return (
    <section className="rounded-lg border border-line bg-surface p-5">
      <h2 className="text-sm font-semibold">
        Tailscale
        {status.available && (
          <span className="ml-2 font-normal text-subtle">
            {t("tailscale.nodes", {
              count: status.peers.length + (status.self ? 1 : 0),
              state: status.backendState,
            })}
          </span>
        )}
      </h2>

      {!status.available ? (
        <p className="mt-2 text-sm text-subtle">{status.error ?? t("tailscale.unreachable")}</p>
      ) : (
        <>
          <p className="mt-1 text-xs text-subtle">
            {status.magicDns && `MagicDNS: ${status.magicDns} · `}
            {t("tailscale.version", { version: status.version })}
            {status.expiring.length > 0 && (
              <span className="text-warn">
                {" · "}
                {t("tailscale.expiring", { count: status.expiring.length })}
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
