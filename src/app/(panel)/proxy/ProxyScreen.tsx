"use client";

import { useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  Globe,
  HelpCircle,
  MinusCircle,
  Pencil,
  Plus,
  RefreshCw,
  ShieldCheck,
  Stethoscope,
  Trash2,
  XCircle,
} from "lucide-react";
import { Modal } from "@/components/Modal";
import { CSRF_COOKIE, CSRF_HEADER } from "@/lib/auth/types";
import type { DdnsRecord } from "@/lib/proxy/ddns";
import type { DiagnoseResult } from "@/lib/proxy/diagnose";
import type { ProxyTargets } from "@/lib/proxy/reachability";
import type { ProxyHostView, TargetKind, TlsMode } from "@/lib/proxy/store";

/**
 * M2.8 — Yayınlama ekranı.
 *
 * Üç şey bir arada: alan adı → hedef eşlemesi, sertifika durumu ve DDNS.
 * Ayrı ekranlara bölünmediler çünkü üçü de tek bir işin parçası — "bu servisi
 * dışarıya nasıl açarım" — ve biri olmadan diğeri çalışmıyor.
 */

function readCsrfToken(): string {
  const match = document.cookie.match(new RegExp(`(?:^|; )${CSRF_COOKIE}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : "";
}

const inputClass =
  "w-full rounded-md border border-line bg-canvas px-2.5 py-1.5 text-sm outline-none focus:border-brand";

const TLS_LABEL: Record<TlsMode, string> = {
  auto: "Let's Encrypt",
  internal: "Caddy yerel CA",
  off: "TLS yok (düz HTTP)",
};

type HostForm = {
  id: number | null;
  domain: string;
  targetKind: TargetKind;
  target: string;
  port: string;
  tls: TlsMode;
  websocket: boolean;
  enabled: boolean;
};

/**
 * Yeni kayıt formunun başlangıcı. TLS'i çağıran veriyor: doğru varsayılan
 * kuruluma göre değişiyor — gerçek bir alan adında `auto`, yalnızca yerel ağda
 * kullanılan `.local` adreslerinde `off` (Let's Encrypt o adresler için hiçbir
 * zaman mümkün değil, `internal` ise her açılışta sertifika uyarısı demek).
 * Ayar: proxy.default_tls.
 */
function emptyHost(defaultTls: TlsMode): HostForm {
  return {
    id: null,
    domain: "",
    targetKind: "container",
    target: "",
    port: "80",
    tls: defaultTls,
    websocket: true,
    enabled: true,
  };
}

type DdnsForm = {
  id: number | null;
  provider: "cloudflare" | "duckdns";
  hostname: string;
  zone: string;
  secret: string;
  enabled: boolean;
};

const EMPTY_DDNS: DdnsForm = {
  id: null,
  provider: "duckdns",
  hostname: "",
  zone: "",
  secret: "",
  enabled: true,
};

function certTone(host: ProxyHostView): { text: string; className: string } {
  if (host.tls === "off") return { text: "TLS yok", className: "text-subtle" };
  if (!host.certificate) return { text: "henüz kontrol edilmedi", className: "text-subtle" };
  if (host.certificate.error) {
    return { text: host.certificate.error, className: "text-danger" };
  }
  if (host.daysLeft === null) return { text: "bitiş okunamadı", className: "text-subtle" };
  if (host.daysLeft < 0) return { text: `${-host.daysLeft} gün önce doldu`, className: "text-danger" };
  if (host.daysLeft <= 21) return { text: `${host.daysLeft} gün kaldı`, className: "text-warn" };
  return { text: `${host.daysLeft} gün kaldı`, className: "text-ok" };
}

/**
 * Caddy'nin host'ta bağlandığı portlar. İkisi ayrı: panel HTTPS'te (443)
 * duruyor ama TLS'i kapalı kayıtlar 80'de sunuluyor.
 */
export type PublishedPorts = { http: number; https: number };

/**
 * Yayınlanan adresin tam hali — Caddy varsayılan portların dışında olabilir.
 *
 * ŞEMANIN KENDİ portu kullanılıyor. Tek port okunduğunda TLS'i kapalı kayıtlar
 * için `http://alan.adı:443` üretiliyordu; hiçbir zaman bağlanamayacak bir
 * adresi tıklanabilir göstermek, hiç göstermemekten kötü.
 */
function publicUrlOf(host: ProxyHostView, ports: PublishedPorts): string {
  const https = host.tls !== "off";
  const port = https ? ports.https : ports.http;
  const bare = https ? port === 443 : port === 80;
  return `${https ? "https" : "http"}://${host.domain}${bare ? "" : `:${port}`}`;
}

export function ProxyScreen({
  initialHosts,
  initialDdns,
  initialConfig,
  targets,
  publishedPorts,
  defaultTls,
}: {
  initialHosts: ProxyHostView[];
  initialDdns: DdnsRecord[];
  initialConfig: string;
  targets: ProxyTargets;
  publishedPorts: PublishedPorts;
  defaultTls: TlsMode;
}) {
  const blankHost = emptyHost(defaultTls);
  const [hosts, setHosts] = useState(initialHosts);
  const [ddns, setDdns] = useState(initialDdns);
  const [config, setConfig] = useState(initialConfig);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showConfig, setShowConfig] = useState(false);
  const [diagnosis, setDiagnosis] = useState<DiagnoseResult | null>(null);

  const [hostModal, setHostModal] = useState<{ open: boolean; form: HostForm }>({
    open: false,
    form: blankHost,
  });
  const [ddnsModal, setDdnsModal] = useState<{ open: boolean; form: DdnsForm }>({
    open: false,
    form: EMPTY_DDNS,
  });

  async function send(
    url: string,
    method: string,
    body?: unknown,
  ): Promise<Record<string, unknown> | null> {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(url, {
        method,
        headers: { "content-type": "application/json", [CSRF_HEADER]: readCsrfToken() },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const data = (await response.json()) as Record<string, unknown>;

      if (!response.ok) {
        setError((data.error as string) ?? "İşlem başarısız.");
        return null;
      }
      if (Array.isArray(data.hosts)) setHosts(data.hosts as ProxyHostView[]);
      if (Array.isArray(data.ddns)) setDdns(data.ddns as DdnsRecord[]);
      if (typeof data.config === "string") setConfig(data.config);

      // Caddy reload sonucu ayrı gösteriliyor: kayıt başarılı ama devreye
      // alınamamış olabilir ve bu ikisi farklı şeyler.
      const reload = data.reload as { ok: boolean; message: string } | undefined;
      if (reload) setNotice(reload.message);

      return data;
    } catch {
      setError("Sunucuya ulaşılamadı.");
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function saveHost() {
    const form = hostModal.form;
    const payload = { ...form, port: Number(form.port) };
    const result =
      form.id === null
        ? await send("/api/proxy", "POST", payload)
        : await send(`/api/proxy/${form.id}`, "PATCH", payload);
    if (result) setHostModal({ open: false, form: blankHost });
  }

  async function diagnose(host: ProxyHostView) {
    setDiagnosis(null);
    const result = await send("/api/proxy/diagnose", "POST", { id: host.id });
    if (result?.result) setDiagnosis(result.result as DiagnoseResult);
  }

  async function removeHost(host: ProxyHostView) {
    if (!confirm(`${host.domain} yayından kaldırılsın mı?`)) return;
    await send(`/api/proxy/${host.id}`, "DELETE");
  }

  async function saveDdns() {
    const result = await send("/api/proxy/ddns", "POST", ddnsModal.form);
    if (result) setDdnsModal({ open: false, form: EMPTY_DDNS });
  }

  async function syncNow() {
    const result = await send("/api/proxy/ddns", "POST", { action: "sync" });
    const summary = result?.result as
      | { updated: string[]; unchanged: string[]; failed: string[] }
      | undefined;
    if (summary) {
      setNotice(
        `DDNS: ${summary.updated.length} güncellendi · ${summary.unchanged.length} değişmedi` +
          (summary.failed.length ? ` · hata: ${summary.failed.join(" | ")}` : ""),
      );
    }
  }

  return (
    <div className="space-y-6">
      {notice && (
        <p className="flex items-start justify-between gap-3 whitespace-pre-wrap rounded-md border border-line bg-surface px-4 py-2 text-sm">
          <span>{notice}</span>
          <button
            type="button"
            onClick={() => setNotice(null)}
            className="shrink-0 text-xs text-subtle hover:text-ink"
          >
            kapat
          </button>
        </p>
      )}
      {error && (
        <p className="rounded-md border border-danger/40 bg-surface px-4 py-2 text-sm text-danger">
          {error}
        </p>
      )}

      <section className="rounded-lg border border-line bg-surface p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <Globe className="size-4 text-subtle" aria-hidden />
            Yayınlanan adresler
            <span className="font-normal text-subtle">{hosts.length}</span>
          </h2>
          <button
            type="button"
            onClick={() => {
              setError(null);
              setHostModal({ open: true, form: blankHost });
            }}
            className="flex items-center gap-1.5 rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-white"
          >
            <Plus className="size-4" /> Adres yayınla
          </button>
        </div>

        <p className="mt-1 text-xs text-subtle">
          Kurallar Caddy&apos;ye ayrı bir dosya olarak yazılır ve <code>caddy reload</code> ile
          devreye alınır. Let&apos;s Encrypt için alan adının bu sunucuya çözülmesi ve 80/443
          portlarının dışarıdan erişilebilir olması gerekir.
        </p>

        {hosts.length === 0 ? (
          <p className="mt-4 text-sm text-subtle">Henüz yayınlanan adres yok.</p>
        ) : (
          <ul className="mt-4 divide-y divide-line rounded-md border border-line">
            {hosts.map((host) => {
              const cert = certTone(host);
              return (
                <li key={host.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      {/*
                        Adres TAM haliyle ve tıklanabilir gösteriliyor. Daha
                        önce yalnızca alan adı yazıyordu; Caddy 443 dışında bir
                        portta olduğunda kullanıcı doğal olarak portsuz deniyor
                        ve bağlanamıyordu (yaşandı).
                      */}
                      <a
                        href={publicUrlOf(host, publishedPorts)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex min-w-0 items-center gap-1 truncate text-sm font-medium text-brand hover:underline"
                      >
                        <span className="truncate">{publicUrlOf(host, publishedPorts)}</span>
                        <ExternalLink className="size-3 shrink-0" aria-hidden />
                      </a>
                      {!host.enabled && (
                        <span className="rounded bg-line px-1 text-[10px] text-subtle">kapalı</span>
                      )}
                    </span>
                    <span className="block truncate font-mono text-[11px] text-subtle">
                      → {host.target}:{host.port} · {TLS_LABEL[host.tls]}
                    </span>
                  </span>

                  <span className={`flex shrink-0 items-center gap-1 text-xs ${cert.className}`}>
                    <ShieldCheck className="size-3.5" aria-hidden />
                    {cert.text}
                  </span>

                  <button
                    type="button"
                    disabled={busy}
                    title="Yayını sına — DNS, bağlantı ve hedefi sırayla dener"
                    onClick={() => void diagnose(host)}
                    aria-label={`${host.domain} yayınını sına`}
                    className="rounded p-1 text-subtle hover:text-brand disabled:opacity-50"
                  >
                    <Stethoscope className="size-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setError(null);
                      setHostModal({
                        open: true,
                        form: {
                          id: host.id,
                          domain: host.domain,
                          targetKind: host.targetKind,
                          target: host.target,
                          port: String(host.port),
                          tls: host.tls,
                          websocket: host.websocket,
                          enabled: host.enabled,
                        },
                      });
                    }}
                    aria-label={`${host.domain} kaydını düzenle`}
                    className="rounded p-1 text-subtle hover:text-ink"
                  >
                    <Pencil className="size-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => void removeHost(host)}
                    aria-label={`${host.domain} kaydını sil`}
                    className="rounded p-1 text-subtle hover:text-danger"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        <button
          type="button"
          onClick={() => setShowConfig((v) => !v)}
          className="mt-3 text-xs text-subtle hover:text-ink"
        >
          {showConfig ? "Üretilen Caddy yapılandırmasını gizle" : "Üretilen Caddy yapılandırmasını göster"}
        </button>
        {showConfig && (
          <pre className="mt-2 max-h-72 overflow-auto rounded-md border border-line bg-canvas p-3 font-mono text-[11px]">
            {config || "(henüz üretilmedi)"}
          </pre>
        )}
      </section>

      <section className="rounded-lg border border-line bg-surface p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-semibold">
            Dinamik DNS <span className="font-normal text-subtle">{ddns.length}</span>
          </h2>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => void syncNow()}
              disabled={busy || ddns.length === 0}
              className="flex items-center gap-1.5 rounded-md border border-line px-3 py-1.5 text-sm hover:border-brand disabled:opacity-50"
            >
              <RefreshCw className="size-4" /> Şimdi eşitle
            </button>
            <button
              type="button"
              onClick={() => {
                setError(null);
                setDdnsModal({ open: true, form: EMPTY_DDNS });
              }}
              className="flex items-center gap-1.5 rounded-md border border-line px-3 py-1.5 text-sm hover:border-brand"
            >
              <Plus className="size-4" /> Kayıt ekle
            </button>
          </div>
        </div>

        <p className="mt-1 text-xs text-subtle">
          Ev IP&apos;si değişince alan adı kaydı güncellenir. IP değişmediyse sağlayıcıya istek
          gitmez.
        </p>

        {ddns.length === 0 ? (
          <p className="mt-4 text-sm text-subtle">Henüz DDNS kaydı yok.</p>
        ) : (
          <ul className="mt-4 divide-y divide-line rounded-md border border-line">
            {ddns.map((record) => (
              <li key={record.id} className="flex items-center gap-3 px-3 py-2.5">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{record.hostname}</span>
                  <span className="block truncate text-[11px] text-subtle">
                    {record.provider}
                    {record.lastIp && ` · ${record.lastIp}`}
                    {record.lastSyncAt &&
                      ` · ${new Date(record.lastSyncAt * 1000).toLocaleString("tr-TR")}`}
                    {!record.hasSecret && " · token girilmemiş"}
                  </span>
                  {record.lastError && (
                    <span className="block text-[11px] text-danger">{record.lastError}</span>
                  )}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setError(null);
                    setDdnsModal({
                      open: true,
                      form: {
                        id: record.id,
                        provider: record.provider,
                        hostname: record.hostname,
                        zone: record.zone,
                        secret: "",
                        enabled: record.enabled,
                      },
                    });
                  }}
                  aria-label={`${record.hostname} kaydını düzenle`}
                  className="rounded p-1 text-subtle hover:text-ink"
                >
                  <Pencil className="size-3.5" />
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    if (!confirm(`${record.hostname} DDNS kaydı silinsin mi?`)) return;
                    await send(`/api/proxy/ddns?id=${record.id}`, "DELETE");
                  }}
                  aria-label={`${record.hostname} kaydını sil`}
                  className="rounded p-1 text-subtle hover:text-danger"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <Modal
        open={hostModal.open}
        title={hostModal.form.id === null ? "Adres yayınla" : "Yayını düzenle"}
        onClose={() => setHostModal((m) => ({ ...m, open: false }))}
      >
        <form
          className="space-y-3 px-5 py-4"
          onSubmit={(e) => {
            e.preventDefault();
            void saveHost();
          }}
        >
          <label className="block">
            <span className="text-xs font-medium">Alan adı</span>
            <input
              type="text"
              value={hostModal.form.domain}
              onChange={(e) =>
                setHostModal((m) => ({ ...m, form: { ...m.form, domain: e.target.value } }))
              }
              placeholder="ha.evim.net"
              autoFocus
              className={`mt-1 font-mono ${inputClass}`}
            />
          </label>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="text-xs font-medium">Hedef türü</span>
              <select
                value={hostModal.form.targetKind}
                onChange={(e) =>
                  setHostModal((m) => ({
                    ...m,
                    form: { ...m.form, targetKind: e.target.value as TargetKind },
                  }))
                }
                className={`mt-1 ${inputClass}`}
              >
                <option value="container">Docker container</option>
                <option value="url">Ağdaki başka makine</option>
              </select>
            </label>

            <label className="block">
              <span className="text-xs font-medium">Hedef</span>
              {hostModal.form.targetKind === "container" ? (
                <select
                  value={hostModal.form.target}
                  onChange={(e) =>
                    setHostModal((m) => ({ ...m, form: { ...m.form, target: e.target.value } }))
                  }
                  className={`mt-1 ${inputClass}`}
                >
                  <option value="">Seç…</option>
                  {targets.containers.map((entry) => (
                    <option key={entry.name} value={entry.name}>
                      {entry.name}
                      {entry.reachable ? "" : " — farklı ağda"}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  type="text"
                  value={hostModal.form.target}
                  onChange={(e) =>
                    setHostModal((m) => ({ ...m, form: { ...m.form, target: e.target.value } }))
                  }
                  placeholder="192.168.61.50"
                  className={`mt-1 font-mono ${inputClass}`}
                />
              )}
            </label>
          </div>

          <NetworkWarning form={hostModal.form} targets={targets} />

          {targets.problem && (
            <p className="flex items-start gap-1.5 rounded-md border border-line px-3 py-2 text-xs text-subtle">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              {targets.problem}
            </p>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="text-xs font-medium">Port</span>
              <input
                type="number"
                value={hostModal.form.port}
                onChange={(e) =>
                  setHostModal((m) => ({ ...m, form: { ...m.form, port: e.target.value } }))
                }
                className={`mt-1 ${inputClass}`}
              />
            </label>

            <label className="block">
              <span className="text-xs font-medium">Sertifika</span>
              <select
                value={hostModal.form.tls}
                onChange={(e) =>
                  setHostModal((m) => ({ ...m, form: { ...m.form, tls: e.target.value as TlsMode } }))
                }
                className={`mt-1 ${inputClass}`}
              >
                <option value="auto">Let&apos;s Encrypt (gerçek alan adı)</option>
                <option value="internal">Caddy yerel CA (LAN)</option>
                <option value="off">TLS yok</option>
              </select>
            </label>
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={hostModal.form.websocket}
              onChange={(e) =>
                setHostModal((m) => ({ ...m, form: { ...m.form, websocket: e.target.checked } }))
              }
              className="size-4 accent-[var(--brand)]"
            />
            WebSocket başlıklarını ilet (Home Assistant, Zigbee2MQTT)
          </label>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={hostModal.form.enabled}
              onChange={(e) =>
                setHostModal((m) => ({ ...m, form: { ...m.form, enabled: e.target.checked } }))
              }
              className="size-4 accent-[var(--brand)]"
            />
            Etkin
          </label>

          {error && <p className="text-sm text-danger">{error}</p>}

          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={() => setHostModal((m) => ({ ...m, open: false }))}
              className="rounded-md border border-line px-3 py-1.5 text-sm text-subtle hover:text-ink"
            >
              Vazgeç
            </button>
            <button
              type="submit"
              disabled={busy}
              className="rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
            >
              {busy ? "Uygulanıyor…" : "Kaydet ve uygula"}
            </button>
          </div>
        </form>
      </Modal>

      <Modal
        open={ddnsModal.open}
        title={ddnsModal.form.id === null ? "DDNS kaydı ekle" : "DDNS kaydını düzenle"}
        onClose={() => setDdnsModal((m) => ({ ...m, open: false }))}
      >
        <form
          className="space-y-3 px-5 py-4"
          onSubmit={(e) => {
            e.preventDefault();
            void saveDdns();
          }}
        >
          <label className="block">
            <span className="text-xs font-medium">Sağlayıcı</span>
            <select
              value={ddnsModal.form.provider}
              onChange={(e) =>
                setDdnsModal((m) => ({
                  ...m,
                  form: { ...m.form, provider: e.target.value as DdnsForm["provider"] },
                }))
              }
              className={`mt-1 ${inputClass}`}
            >
              <option value="duckdns">DuckDNS (alan adı gerekmez)</option>
              <option value="cloudflare">Cloudflare (kendi alan adın)</option>
            </select>
          </label>

          <label className="block">
            <span className="text-xs font-medium">Alan adı</span>
            <input
              type="text"
              value={ddnsModal.form.hostname}
              onChange={(e) =>
                setDdnsModal((m) => ({ ...m, form: { ...m.form, hostname: e.target.value } }))
              }
              placeholder={
                ddnsModal.form.provider === "duckdns" ? "evim.duckdns.org" : "ev.example.com"
              }
              className={`mt-1 font-mono ${inputClass}`}
            />
          </label>

          {ddnsModal.form.provider === "cloudflare" && (
            <label className="block">
              <span className="text-xs font-medium">Zone ID</span>
              <input
                type="text"
                value={ddnsModal.form.zone}
                onChange={(e) =>
                  setDdnsModal((m) => ({ ...m, form: { ...m.form, zone: e.target.value } }))
                }
                className={`mt-1 font-mono ${inputClass}`}
              />
              <span className="mt-1 block text-[11px] text-subtle">
                Cloudflare panelinde alan adının genel bakış sayfasının sağ sütununda yazıyor.
              </span>
            </label>
          )}

          <label className="block">
            <span className="text-xs font-medium">
              {ddnsModal.form.provider === "duckdns" ? "DuckDNS token" : "API token"}
            </span>
            <input
              type="password"
              value={ddnsModal.form.secret}
              onChange={(e) =>
                setDdnsModal((m) => ({ ...m, form: { ...m.form, secret: e.target.value } }))
              }
              placeholder={ddnsModal.form.id === null ? "" : "kayıtlı — değiştirmek için yaz"}
              className={`mt-1 ${inputClass}`}
            />
            <span className="mt-1 block text-[11px] text-subtle">
              Şifrelenerek saklanır (T3). Cloudflare&apos;de yalnızca <em>Zone → DNS → Edit</em>{" "}
              yetkisi olan bir token üret; hesabın tamamına yetkili anahtar kullanma.
            </span>
          </label>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={ddnsModal.form.enabled}
              onChange={(e) =>
                setDdnsModal((m) => ({ ...m, form: { ...m.form, enabled: e.target.checked } }))
              }
              className="size-4 accent-[var(--brand)]"
            />
            Etkin
          </label>

          {error && <p className="text-sm text-danger">{error}</p>}

          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={() => setDdnsModal((m) => ({ ...m, open: false }))}
              className="rounded-md border border-line px-3 py-1.5 text-sm text-subtle hover:text-ink"
            >
              Vazgeç
            </button>
            <button
              type="submit"
              disabled={busy}
              className="rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
            >
              {busy ? "Kaydediliyor…" : "Kaydet"}
            </button>
          </div>
        </form>
      </Modal>

      <DiagnoseModal result={diagnosis} onClose={() => setDiagnosis(null)} />
    </div>
  );
}

/**
 * Hedef container Caddy ile aynı ağda değilse uyarır.
 *
 * `caddy.ts` içindeki yorum yıllardır "ekranda uyarı gösteriliyor" diyordu ama
 * böyle bir uyarı yoktu; kullanıcı ancak Caddy loglarında görebiliyordu.
 * `pihole` kaydı tam olarak bu yüzden sessizce çalışmadı.
 */
function NetworkWarning({
  form,
  targets,
}: {
  form: HostForm;
  targets: ProxyTargets;
}) {
  if (form.targetKind !== "container" || !form.target) return null;

  const entry = targets.containers.find((item) => item.name === form.target);
  if (!entry || entry.reachable) return null;

  // `network_mode: host` kullanan container'da Docker port EŞLEMESİ bildirmez;
  // `publishedPorts` boş gelir. Eski metin bu durumda portsuz, yarım bir öneri
  // veriyordu — oysa cevap belli: uygulamanın kendi portu host'un portudur.
  const hostAginda = entry.networks.includes("host");

  return (
    <p className="flex items-start gap-1.5 rounded-md border border-warn/40 bg-warn/5 px-3 py-2 text-xs text-warn">
      <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
      <span>
        <strong>Bu hâliyle kaydedersen sayfa 502 verir.</strong>{" "}
        <strong>{targets.caddyName}</strong>, container adlarını yalnızca{" "}
        <em>ortak olduğu ağlarda</em> çözebilir — <strong>{form.target}</strong> ile ortak bir
        ağı yok ({entry.networks.join(", ") || "ağı yok"} ↔{" "}
        {targets.caddyNetworks.join(", ") || "ağı yok"}).
        <br />
        <span className="opacity-90">
          Bu normaldir, hedefin yanlış kurulduğu anlamına gelmez: her compose yığını kendi ağını
          yaratır ve bu ağlar birbirinden yalıtılmıştır. Caddy de bir yığında yaşadığı için
          yalnızca kendi yığınındaki container&apos;ları adla çözebiliyor.
        </span>
        <br />
        <strong>İki çözümden biri:</strong>
        <br />
        1. Hedef türünü &ldquo;Ağdaki başka makine&rdquo; yap
        {hostAginda ? (
          <>
            {" "}
            ve sunucunun IP&apos;si ile <em>uygulamanın kendi portunu</em> yaz. Bu container host
            ağını kullanıyor, yani portlarını doğrudan host&apos;ta açıyor; Docker port eşlemesi
            bildirmediği için panel örnek veremiyor.
          </>
        ) : entry.publishedPorts.length > 0 ? (
          <>
            {" "}
            ve sunucunun IP&apos;si ile yayınlanmış portu yaz (ör. hedef{" "}
            <code className="font-mono">192.168.61.114</code>, port{" "}
            <code className="font-mono">{entry.publishedPorts[0]}</code>). Adı değil ağ üzerinden
            bir adres verdiğin için Caddy&apos;nin isim çözmesi gerekmez.
          </>
        ) : (
          <>
            {" "}
            ve sunucunun IP&apos;si ile bir port yaz — ama bu container hiçbir port
            <strong> yayınlamıyor</strong>, yani önce compose dosyasında ona bir port vermen
            gerekiyor.
          </>
        )}
        <br />
        2. Ya da <strong>{targets.caddyName}</strong>&apos;yi{" "}
        <code className="font-mono">{entry.networks[0] ?? "bu container'ın ağına"}</code> ağına
        bağla; o zaman adla çözebilir.
      </span>
    </p>
  );
}

const STEP_ICON = {
  ok: CheckCircle2,
  fail: XCircle,
  skip: MinusCircle,
  unknown: HelpCircle,
} as const;

const STEP_TONE = {
  ok: "text-ok",
  fail: "text-danger",
  skip: "text-subtle",
  unknown: "text-warn",
} as const;

/** Üç katmanın hangisinin düştüğünü gösterir (M2.8 düzeltmesi). */
function DiagnoseModal({
  result,
  onClose,
}: {
  result: DiagnoseResult | null;
  onClose: () => void;
}) {
  return (
    <Modal open={result !== null} title="Yayın sınaması" onClose={onClose} wide>
      {result && (
        <div className="space-y-3">
          <p className="text-sm">
            <span className="text-subtle">Adres:</span>{" "}
            <a
              href={result.url}
              target="_blank"
              rel="noopener noreferrer"
              className="font-mono text-brand hover:underline"
            >
              {result.url}
            </a>
          </p>

          <ol className="space-y-2">
            {result.steps.map((step) => {
              const Icon = STEP_ICON[step.status];
              return (
                <li
                  key={step.key}
                  className="rounded-md border border-line px-3 py-2"
                >
                  <div className={`flex items-center gap-2 text-sm font-medium ${STEP_TONE[step.status]}`}>
                    <Icon className="size-4 shrink-0" aria-hidden />
                    {step.label}
                  </div>
                  <p className="mt-1 whitespace-pre-wrap break-words font-mono text-[11px] text-subtle">
                    {step.detail}
                  </p>
                  {step.hint && (
                    <p className="mt-1.5 rounded bg-brand/5 px-2 py-1.5 text-xs">{step.hint}</p>
                  )}
                </li>
              );
            })}
          </ol>

          <p
            className={`text-sm font-medium ${
              !result.ok
                ? "text-danger"
                : result.steps.some((step) => step.status === "unknown")
                  ? "text-warn"
                  : "text-ok"
            }`}
          >
            {!result.ok
              ? "En az bir adım düştü; yukarıdaki öneriye bak."
              : result.steps.some((step) => step.status === "unknown")
                ? "Düşen adım yok ama bir adım panelden sınanamadı — açıklamaya bak."
                : "Üç adım da geçti — adres çalışıyor olmalı."}
          </p>
        </div>
      )}
    </Modal>
  );
}
