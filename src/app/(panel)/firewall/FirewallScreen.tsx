"use client";

import { useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  Plus,
  ShieldCheck,
  ShieldOff,
  Trash2,
} from "lucide-react";

import { CSRF_COOKIE, CSRF_HEADER } from "@/lib/auth/types";
import type { FirewallState } from "@/lib/security/firewall";

/**
 * M3.18 — güvenlik duvarı ekranı.
 *
 * M3.7'de bu, Güvenlik ekranının bir bölümüydü. Kendi menüsüne çıkmasının
 * sebebi büyümesi değil, EKSİKLERİ: ufw'yi açıp kapatmak, varsayılan politikayı
 * görmek ve kuralı serbest metin yerine forma yazmak buraya sığmıyordu.
 *
 * İKİ ŞEY BİLEREK GÖSTERİLİYOR:
 *
 *   1. Varsayılan politika. Gelen trafiğin varsayılanı "allow" ise kural
 *      listesi ne kadar dolu olursa olsun güvenlik duvarı bir şey korumaz ve
 *      bu, kurallara bakan birinin göremeyeceği bir gerçektir.
 *   2. "Docker yayınlı" rozeti. Docker kendi iptables kurallarını ufw'nin
 *      zincirinden ÖNCE çalışan `DOCKER-USER`'a yazar; yayınlanmış bir porta
 *      yazılan deny kuralı ETKİSİZDİR. Bunu göstermemek, kullanıcıya olmayan
 *      bir güvenliği varmış gibi sunmak olurdu.
 */

function readCsrfToken(): string {
  const match = document.cookie.match(new RegExp(`(?:^|; )${CSRF_COOKIE}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : "";
}

type Pending = {
  body: Record<string, unknown>;
  warning: string;
  label: string;
};

export function FirewallScreen({
  initial,
  listeners,
  dockerPublished,
  portsScannedAt,
  canManage,
}: {
  initial: FirewallState;
  /** port → o portu dinleyen sahibin adı (Port Haritası önbelleğinden). */
  listeners: Record<string, string>;
  dockerPublished: number[];
  portsScannedAt: number | null;
  canManage: boolean;
}) {
  const [firewall, setFirewall] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);

  const [mode, setMode] = useState<"port" | "source">("port");
  const [kind, setKind] = useState<"allow" | "deny">("allow");
  const [port, setPort] = useState("");
  const [proto, setProto] = useState<"" | "tcp" | "udp">("tcp");
  const [source, setSource] = useState("");
  const [comment, setComment] = useState("");

  const publishedSet = new Set(dockerPublished);

  /**
   * Formdan ufw kuralını üretir.
   *
   * Serbest metin kutusu bilerek kaldırıldı: helper yalnızca iki kalıbı kabul
   * ediyor ve kullanıcının onları ezberlemesini beklemek, "gecersiz ufw
   * kurali" hatasını ekranın olağan cevabı hâline getiriyordu.
   */
  function buildRule(): string {
    const number = port.trim();
    if (!number) return "";
    if (mode === "port") return proto ? `${number}/${proto}` : number;
    if (!source.trim()) return "";
    return `from ${source.trim()} to any port ${number}${proto ? ` proto ${proto}` : ""}`;
  }

  async function send(body: Record<string, unknown>, label: string) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch("/api/firewall", {
        method: "POST",
        headers: { "content-type": "application/json", [CSRF_HEADER]: readCsrfToken() },
        body: JSON.stringify(body),
      });
      const data = (await response.json()) as {
        error?: string;
        message?: string;
        needsConfirmation?: boolean;
        firewall?: FirewallState;
      };

      if (response.status === 409 && data.needsConfirmation) {
        setPending({ body, warning: data.error ?? "", label });
        return false;
      }

      if (data.firewall) setFirewall(data.firewall);
      if (!response.ok) {
        setError(data.error ?? data.message ?? "İşlem başarısız.");
        return false;
      }
      setNotice(data.message ?? "Tamam.");
      setPending(null);
      return true;
    } catch {
      setError("Sunucuya ulaşılamadı.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      {error && (
        <p role="alert" className="rounded-lg bg-danger/10 px-4 py-2.5 text-sm text-danger">
          {error}
        </p>
      )}
      {notice && <p className="rounded-lg bg-ok/10 px-4 py-2.5 text-sm text-ok">{notice}</p>}

      {pending && (
        <div className="rounded-lg border border-danger/50 bg-danger/5 p-4">
          <p className="flex items-start gap-2 text-sm font-medium text-danger">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden /> {pending.warning}
          </p>
          <p className="mt-1 text-xs text-subtle">
            İşlem: <code className="font-mono">{pending.label}</code>
          </p>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={() => setPending(null)}
              className="rounded-md border border-line px-3 py-1.5 text-sm"
            >
              Vazgeç
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void send({ ...pending.body, confirmed: true }, pending.label)}
              className="rounded-md bg-danger px-3 py-1.5 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              Riski anladım, devam et
            </button>
          </div>
        </div>
      )}

      {/* --- Durum ve varsayılan politika --- */}
      <section className="rounded-lg border border-line bg-surface">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            {firewall.active ? (
              <ShieldCheck className="size-4 text-ok" aria-hidden />
            ) : (
              <ShieldOff className="size-4 text-warn" aria-hidden />
            )}
            Güvenlik duvarı (ufw)
          </h2>
          <div className="flex items-center gap-3">
            <span
              className={`text-xs ${
                firewall.available ? (firewall.active ? "text-ok" : "text-warn") : "text-subtle"
              }`}
            >
              {firewall.message}
            </span>
            {firewall.available && canManage && (
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  void send(
                    { action: firewall.active ? "disable" : "enable" },
                    firewall.active ? "ufw disable" : "ufw enable",
                  )
                }
                className="rounded-md border border-line px-3 py-1.5 text-sm transition-colors hover:border-brand disabled:opacity-50"
              >
                {firewall.active ? "Kapat" : "Etkinleştir"}
              </button>
            )}
          </div>
        </div>

        {firewall.setupHint && (
          <div className="border-b border-line bg-warn/5 px-5 py-3">
            <p className="text-xs text-warn">
              Bunu açmak için host&apos;ta root olarak izin listesine satır eklemen gerekiyor:
            </p>
            <code className="mt-1 block select-all overflow-x-auto whitespace-pre rounded bg-canvas px-2 py-1.5 font-mono text-[11px]">
              {firewall.setupHint}
            </code>
          </div>
        )}

        {firewall.available && (
          <div className="flex flex-wrap items-center gap-4 px-5 py-3 text-xs">
            {firewall.defaults ? (
              <>
                <Policy
                  label="Gelen"
                  value={firewall.defaults.incoming}
                  direction="incoming"
                  busy={busy}
                  canManage={canManage}
                  onChange={(policy) =>
                    void send(
                      { action: "default", policy, direction: "incoming" },
                      `ufw default ${policy} incoming`,
                    )
                  }
                />
                <Policy
                  label="Giden"
                  value={firewall.defaults.outgoing}
                  direction="outgoing"
                  busy={busy}
                  canManage={canManage}
                  onChange={(policy) =>
                    void send(
                      { action: "default", policy, direction: "outgoing" },
                      `ufw default ${policy} outgoing`,
                    )
                  }
                />
                <span className="text-subtle">Yönlendirilen: {firewall.defaults.routed}</span>
                {firewall.logging && <span className="text-subtle">Log: {firewall.logging}</span>}
              </>
            ) : (
              <span className="text-subtle">
                Varsayılan politika okunamadı — izin listesinde{" "}
                <code className="font-mono">ufw.status_verbose</code> satırı yok.
              </span>
            )}
          </div>
        )}
      </section>

      {/* --- Kurallar --- */}
      {firewall.available && (
        <section className="rounded-lg border border-line bg-surface">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3">
            <h2 className="text-sm font-semibold">Kurallar ({firewall.rules.length})</h2>
            <span className="text-xs text-subtle">
              {portsScannedAt === null ? (
                <>
                  Port sahipliği bilinmiyor —{" "}
                  <Link href="/ports" className="underline underline-offset-2">
                    Port Haritası
                  </Link>{" "}
                  henüz taranmadı.
                </>
              ) : (
                <>
                  Sahiplik bilgisi{" "}
                  <Link href="/ports" className="underline underline-offset-2">
                    Port Haritası
                  </Link>
                  &apos;ndan
                </>
              )}
            </span>
          </div>

          <ul className="divide-y divide-line">
            {firewall.rules.length === 0 && (
              <li className="px-5 py-6 text-center text-sm text-subtle">Tanımlı kural yok.</li>
            )}
            {firewall.rules.map((entry) => {
              const rulePort = Number(entry.to.match(/^(\d{1,5})/)?.[1] ?? 0);
              const listener = listeners[String(rulePort)];
              const bypassed = publishedSet.has(rulePort) && /^DENY/i.test(entry.action);

              return (
                <li key={entry.number} className="flex flex-wrap items-center gap-3 px-5 py-2 text-sm">
                  <span className="w-8 shrink-0 text-right font-mono text-xs text-subtle">
                    {entry.number}
                  </span>
                  <span className="min-w-0 flex-1 font-mono text-xs">
                    {entry.raw}
                    {entry.comment && (
                      <span className="ml-2 font-sans text-[11px] text-subtle">
                        {entry.comment}
                      </span>
                    )}
                  </span>

                  {listener && (
                    <span className="text-[11px] text-subtle" title="Bu portu dinleyen">
                      {listener}
                    </span>
                  )}
                  {bypassed && (
                    <span
                      className="flex items-center gap-1 rounded border border-warn/40 px-1.5 py-0.5 text-[11px] text-warn"
                      title="Docker bu portu yayınlıyor. Docker'ın iptables kuralları ufw'den önce çalıştığı için bu deny kuralı uygulanmaz."
                    >
                      <AlertTriangle className="size-3" aria-hidden />
                      ufw atlanıyor
                    </span>
                  )}

                  {canManage && (
                    <button
                      type="button"
                      disabled={busy}
                      title="Kuralı sil"
                      onClick={() => {
                        if (confirm(`${entry.number}. kural silinsin mi?\n${entry.raw}`)) {
                          void send(
                            { action: "delete", number: entry.number },
                            `ufw delete ${entry.number}`,
                          );
                        }
                      }}
                      className="rounded border border-line p-1.5 text-subtle transition-colors hover:text-danger disabled:opacity-50"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  )}
                </li>
              );
            })}
          </ul>

          {canManage && (
            <div className="space-y-3 border-t border-line px-5 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <select
                  value={kind}
                  onChange={(event) => setKind(event.target.value as "allow" | "deny")}
                  className="rounded-md border border-line bg-canvas px-2 py-1.5 text-sm outline-none focus:border-brand"
                >
                  <option value="allow">İzin ver</option>
                  <option value="deny">Reddet</option>
                </select>
                <select
                  value={mode}
                  onChange={(event) => setMode(event.target.value as "port" | "source")}
                  className="rounded-md border border-line bg-canvas px-2 py-1.5 text-sm outline-none focus:border-brand"
                >
                  <option value="port">Herkese</option>
                  <option value="source">Yalnızca kaynaktan</option>
                </select>

                {mode === "source" && (
                  <input
                    value={source}
                    onChange={(event) => setSource(event.target.value)}
                    placeholder="192.168.61.0/24"
                    className="w-40 rounded-md border border-line bg-canvas px-3 py-1.5 font-mono text-sm outline-none focus:border-brand"
                  />
                )}

                <input
                  value={port}
                  onChange={(event) => setPort(event.target.value)}
                  placeholder="port"
                  inputMode="numeric"
                  className="w-24 rounded-md border border-line bg-canvas px-3 py-1.5 font-mono text-sm outline-none focus:border-brand"
                />
                <select
                  value={proto}
                  onChange={(event) => setProto(event.target.value as "" | "tcp" | "udp")}
                  className="rounded-md border border-line bg-canvas px-2 py-1.5 text-sm outline-none focus:border-brand"
                >
                  <option value="tcp">tcp</option>
                  <option value="udp">udp</option>
                  <option value="">ikisi</option>
                </select>
                <input
                  value={comment}
                  onChange={(event) => setComment(event.target.value)}
                  placeholder="açıklama (isteğe bağlı)"
                  className="min-w-0 flex-1 rounded-md border border-line bg-canvas px-3 py-1.5 text-sm outline-none focus:border-brand sm:min-w-48"
                />

                <button
                  type="button"
                  disabled={busy || !buildRule()}
                  onClick={async () => {
                    const rule = buildRule();
                    const ok = await send(
                      { action: "add", rule, kind, comment: comment.trim() },
                      `ufw ${kind} ${rule}`,
                    );
                    if (ok) {
                      setPort("");
                      setSource("");
                      setComment("");
                    }
                  }}
                  className="flex items-center gap-1.5 rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
                >
                  <Plus className="size-4" /> Ekle
                </button>
              </div>

              <p className="text-xs text-subtle">
                Oluşacak kural:{" "}
                <code className="font-mono">{buildRule() || "—"}</code> · Söz dizimi host tarafında
                da doğrulanıyor, panel yalnızca kabul edilen iki kalıbı üretebilir.
              </p>
            </div>
          )}
        </section>
      )}
    </div>
  );
}

function Policy({
  label,
  value,
  direction,
  busy,
  canManage,
  onChange,
}: {
  label: string;
  value: string;
  direction: "incoming" | "outgoing";
  busy: boolean;
  canManage: boolean;
  onChange: (policy: string) => void;
}) {
  // "Gelen: allow" güvenlik duvarını anlamsız kılar; renk bunu söylüyor.
  const risky = direction === "incoming" ? value === "allow" : value !== "allow";

  if (!canManage) {
    return (
      <span className={risky ? "text-warn" : "text-subtle"}>
        {label}: {value}
      </span>
    );
  }

  return (
    <label className={`flex items-center gap-1.5 ${risky ? "text-warn" : "text-subtle"}`}>
      {label}:
      <select
        value={value}
        disabled={busy}
        onChange={(event) => onChange(event.target.value)}
        className="rounded border border-line bg-canvas px-1.5 py-0.5 text-xs outline-none focus:border-brand disabled:opacity-50"
      >
        <option value="deny">deny</option>
        <option value="allow">allow</option>
        <option value="reject">reject</option>
      </select>
    </label>
  );
}
