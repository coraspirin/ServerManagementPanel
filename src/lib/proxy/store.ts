import "server-only";

import { getDb } from "@/lib/db/client";

/** M2.8 — yayınlanan alan adları ve sertifika durumları. */

export type TlsMode = "auto" | "internal" | "off";
export type TargetKind = "container" | "url";

export type ProxyHost = {
  id: number;
  domain: string;
  targetKind: TargetKind;
  target: string;
  port: number;
  tls: TlsMode;
  websocket: boolean;
  enabled: boolean;
  appId: number | null;
};

export type CertificateInfo = {
  issuer: string;
  subject: string;
  notAfter: number | null;
  checkedAt: number;
  error: string;
};

export type ProxyHostView = ProxyHost & {
  certificate: CertificateInfo | null;
  /** Bitişe kalan gün; sertifika yoksa null. */
  daysLeft: number | null;
};

type Row = {
  id: number;
  domain: string;
  target_kind: string;
  target: string;
  port: number;
  tls: string;
  websocket: number;
  enabled: number;
  app_id: number | null;
};

function toHost(row: Row): ProxyHost {
  return {
    id: row.id,
    domain: row.domain,
    targetKind: row.target_kind as TargetKind,
    target: row.target,
    port: row.port,
    tls: row.tls as TlsMode,
    websocket: row.websocket === 1,
    enabled: row.enabled === 1,
    appId: row.app_id,
  };
}

export function listProxyHosts(): ProxyHost[] {
  return (
    getDb().prepare("SELECT * FROM proxy_hosts ORDER BY domain").all() as Row[]
  ).map(toHost);
}

export function getProxyHost(id: number): ProxyHost | null {
  const row = getDb().prepare("SELECT * FROM proxy_hosts WHERE id = ?").get(id) as
    | Row
    | undefined;
  return row ? toHost(row) : null;
}

export function proxyHostViews(): ProxyHostView[] {
  const certs = new Map(
    (
      getDb().prepare("SELECT * FROM certificates").all() as (CertificateInfo & {
        proxy_host_id: number;
        not_after: number | null;
        checked_at: number;
      })[]
    ).map((row) => [
      row.proxy_host_id,
      {
        issuer: row.issuer,
        subject: row.subject,
        notAfter: row.not_after,
        checkedAt: row.checked_at,
        error: row.error,
      } as CertificateInfo,
    ]),
  );

  const now = Math.floor(Date.now() / 1000);
  return listProxyHosts().map((host) => {
    const certificate = certs.get(host.id) ?? null;
    return {
      ...host,
      certificate,
      daysLeft:
        certificate?.notAfter != null
          ? Math.floor((certificate.notAfter - now) / 86400)
          : null,
    };
  });
}

export type ProxyInput = {
  domain: string;
  targetKind: TargetKind;
  target: string;
  port: number;
  tls: TlsMode;
  websocket: boolean;
  enabled: boolean;
  appId: number | null;
};

/**
 * Alan adı doğrulaması.
 *
 * Caddy yapılandırmasına yazılacak bir değer bu; boşluk ya da süslü parantez
 * içeren bir dize sözdizimini bozar ve Caddy yeniden yüklenemez hale gelir —
 * yani panelin kendi girişi de düşer. Bu yüzden desen DAR tutuluyor.
 */
export function validateProxy(input: ProxyInput): string | null {
  const domain = input.domain.trim().toLowerCase();
  if (!domain) return "Alan adı boş olamaz.";
  if (!/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(domain)) {
    return "Alan adı yalnızca harf, rakam, nokta ve tire içerebilir (ör. ha.evim.net).";
  }
  if (!domain.includes(".") && input.tls === "auto") {
    return "Let's Encrypt için gerçek bir alan adı gerekir (nokta içermeli). LAN'da 'Caddy yerel CA' seç.";
  }

  if (!input.target.trim()) return "Hedef boş olamaz.";
  if (!/^[a-zA-Z0-9](?:[a-zA-Z0-9._-]*[a-zA-Z0-9])?$/.test(input.target.trim())) {
    return "Hedef bir container adı ya da makine adı/IP olmalı.";
  }

  if (!Number.isInteger(input.port) || input.port < 1 || input.port > 65535) {
    return "Port 1–65535 arasında olmalı.";
  }

  return null;
}

export function createProxyHost(input: ProxyInput): number {
  const result = getDb()
    .prepare(
      `INSERT INTO proxy_hosts (domain, target_kind, target, port, tls, websocket, enabled, app_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.domain.trim().toLowerCase(),
      input.targetKind,
      input.target.trim(),
      input.port,
      input.tls,
      input.websocket ? 1 : 0,
      input.enabled ? 1 : 0,
      input.appId,
    );
  return Number(result.lastInsertRowid);
}

export function updateProxyHost(id: number, input: ProxyInput): void {
  getDb()
    .prepare(
      `UPDATE proxy_hosts
       SET domain = ?, target_kind = ?, target = ?, port = ?, tls = ?,
           websocket = ?, enabled = ?, app_id = ?, updated_at = unixepoch()
       WHERE id = ?`,
    )
    .run(
      input.domain.trim().toLowerCase(),
      input.targetKind,
      input.target.trim(),
      input.port,
      input.tls,
      input.websocket ? 1 : 0,
      input.enabled ? 1 : 0,
      input.appId,
      id,
    );
}

export function deleteProxyHost(id: number): void {
  getDb().prepare("DELETE FROM proxy_hosts WHERE id = ?").run(id);
}

export function saveCertificate(proxyHostId: number, info: CertificateInfo): void {
  getDb()
    .prepare(
      `INSERT INTO certificates (proxy_host_id, issuer, subject, not_after, checked_at, error)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(proxy_host_id) DO UPDATE SET
         issuer = excluded.issuer, subject = excluded.subject,
         not_after = excluded.not_after, checked_at = excluded.checked_at,
         error = excluded.error`,
    )
    .run(
      proxyHostId,
      info.issuer,
      info.subject,
      info.notAfter,
      info.checkedAt,
      info.error,
    );
}
