"use client";

import { useCallback, useState } from "react";
import {
  AlertTriangle,
  Ban,
  Bug,
  Check,
  KeyRound,
  RotateCw,
  Router,
  ShieldAlert,
  Trash2,
} from "lucide-react";
import { CSRF_COOKIE, CSRF_HEADER } from "@/lib/auth/types";
import type { Fail2banState, FailedLogin } from "@/lib/security/fail2ban";
import type { SshAudit } from "@/lib/security/sshkeys";
import type { PortForward } from "@/lib/security/upnp";
import type { ScanRow } from "@/lib/security/vuln";

/** M3.8 — güvenlik izleme panelleri. Her biri kendi verisini kendi çekiyor. */

function readCsrfToken(): string {
  const match = document.cookie.match(new RegExp(`(?:^|; )${CSRF_COOKIE}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : "";
}

async function api(body: Record<string, unknown>) {
  const response = await fetch("/api/security/monitor", {
    method: "POST",
    headers: { "content-type": "application/json", [CSRF_HEADER]: readCsrfToken() },
    body: JSON.stringify(body),
  });
  return { response, data: (await response.json()) as Record<string, unknown> };
}

function when(ts: number): string {
  return new Date(ts * 1000).toLocaleString("tr-TR");
}

/* ---------------- CVE taraması ---------------- */

export function VulnPanel({
  initial,
  canManage,
}: {
  initial: ScanRow[];
  canManage: boolean;
}) {
  const [scans, setScans] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  async function scan() {
    setBusy(true);
    setNotice("Taranıyor… ilk turda açık veritabanı indiriliyor, dakikalar sürebilir.");
    const { data } = await api({ action: "scan-vuln" });
    setNotice(String(data.message ?? "Tamamlandı."));
    if (data.scans) setScans(data.scans as ScanRow[]);
    setBusy(false);
  }

  const totalCritical = scans.reduce((sum, scan) => sum + scan.critical, 0);

  return (
    <section className="rounded-lg border border-line bg-surface">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <Bug className="size-4 text-subtle" aria-hidden />
          Image güvenlik açıkları
          {scans.length > 0 && (
            <span className={`font-normal ${totalCritical > 0 ? "text-danger" : "text-ok"}`}>
              {totalCritical} kritik
            </span>
          )}
        </h2>
        {canManage && (
          <button
            type="button"
            onClick={() => void scan()}
            disabled={busy}
            className="flex items-center gap-1.5 rounded-md border border-line px-3 py-1.5 text-sm transition-colors hover:border-brand disabled:opacity-50"
          >
            <RotateCw className={`size-4 ${busy ? "animate-spin" : ""}`} /> Şimdi tara
          </button>
        )}
      </div>

      {notice && <p className="border-b border-line px-5 py-2 text-xs text-subtle">{notice}</p>}

      <p className="border-b border-line bg-brand/5 px-5 py-2 text-xs text-subtle">
        Bir bulgu yargı değil envanter: çoğu CVE, o container&apos;da hiç çalışmayan bir kod
        yolunda. Yalnızca <strong>düzeltmesi olan</strong> açıklar listeleniyor — kapatılamayan
        bir açık için yapılacak bir şey yok.
      </p>

      {scans.length === 0 ? (
        <p className="px-5 py-8 text-center text-sm text-subtle">
          Henüz tarama yapılmadı. Haftalık iş kendiliğinden çalışır.
        </p>
      ) : (
        <ul className="divide-y divide-line">
          {scans.map((scan) => (
            <li key={scan.image}>
              <button
                type="button"
                onClick={() => setOpen(open === scan.image ? null : scan.image)}
                className="flex w-full flex-wrap items-center gap-3 px-5 py-2.5 text-left hover:bg-line/30"
              >
                <span className="min-w-0 flex-1 truncate font-mono text-xs">{scan.image}</span>
                {scan.ok ? (
                  <span className="flex gap-2 text-xs">
                    {scan.critical > 0 && (
                      <span className="rounded bg-danger/15 px-1.5 py-0.5 font-medium text-danger">
                        {scan.critical} kritik
                      </span>
                    )}
                    {scan.high > 0 && (
                      <span className="rounded bg-warn/15 px-1.5 py-0.5 font-medium text-warn">
                        {scan.high} yüksek
                      </span>
                    )}
                    {scan.medium > 0 && (
                      <span className="rounded bg-line px-1.5 py-0.5 text-subtle">
                        {scan.medium} orta
                      </span>
                    )}
                    {scan.critical + scan.high + scan.medium === 0 && (
                      <span className="text-ok">temiz</span>
                    )}
                  </span>
                ) : (
                  <span className="text-xs text-danger">{scan.error.slice(0, 80)}</span>
                )}
                <span className="shrink-0 text-[11px] text-subtle">{when(scan.ts)}</span>
              </button>

              {open === scan.image && scan.findings.length > 0 && (
                <div className="overflow-x-auto border-t border-line bg-canvas/50 px-5 py-2">
                  <table className="rtable w-full text-[11px]">
                    <thead className="text-left text-subtle">
                      <tr>
                        <th className="py-1 pr-3 font-medium">CVE</th>
                        <th className="py-1 pr-3 font-medium">Önem</th>
                        <th className="py-1 pr-3 font-medium">Paket</th>
                        <th className="py-1 pr-3 font-medium">Kurulu</th>
                        <th className="py-1 pr-3 font-medium">Düzeltilmiş</th>
                      </tr>
                    </thead>
                    <tbody className="font-mono">
                      {scan.findings.slice(0, 40).map((finding) => (
                        <tr key={finding.id + finding.package}>
                          <td data-label="" className="py-0.5 pr-3">{finding.id}</td>
                          <td
                            data-label="Önem"
                            className={`py-0.5 pr-3 ${
                              finding.severity === "CRITICAL" ? "text-danger" : "text-warn"
                            }`}
                          >
                            {finding.severity}
                          </td>
                          <td data-label="Paket" className="py-0.5 pr-3">{finding.package}</td>
                          <td data-label="Kurulu" className="py-0.5 pr-3">{finding.installed}</td>
                          <td data-label="Düzeltilmiş" className="py-0.5 pr-3 text-ok">{finding.fixed}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/* ---------------- fail2ban + başarısız girişler ---------------- */

export function IntrusionPanel({
  initialFailed,
  canManage,
}: {
  initialFailed: FailedLogin[];
  canManage: boolean;
}) {
  const [state, setState] = useState<Fail2banState | null>(null);
  const [failed, setFailed] = useState(initialFailed);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const response = await fetch("/api/security/monitor?mode=fail2ban", { cache: "no-store" });
      const data = (await response.json()) as {
        fail2ban: Fail2banState;
        failedLogins: FailedLogin[];
      };
      setState(data.fail2ban);
      setFailed(data.failedLogins);
    } finally {
      setBusy(false);
    }
  }, []);

  return (
    <section className="rounded-lg border border-line bg-surface">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <Ban className="size-4 text-subtle" aria-hidden />
          Yasaklar ve başarısız girişler
          {state && <span className="font-normal text-subtle">{state.message}</span>}
        </h2>
        <button
          type="button"
          onClick={() => void load()}
          disabled={busy}
          className="flex items-center gap-1.5 rounded-md border border-line px-3 py-1.5 text-sm transition-colors hover:border-brand disabled:opacity-50"
        >
          <RotateCw className={`size-4 ${busy ? "animate-spin" : ""}`} />
          {state ? "Yenile" : "fail2ban'ı oku"}
        </button>
      </div>

      {state?.setupHint && (
        <div className="border-b border-line bg-warn/5 px-5 py-3">
          <p className="text-xs text-warn">{state.message}</p>
          <code className="mt-1 block select-all whitespace-pre-wrap rounded bg-canvas px-2 py-1.5 font-mono text-[11px]">
            {state.setupHint}
          </code>
        </div>
      )}

      {state?.available && (
        <ul className="divide-y divide-line">
          {state.jails.map((jail) => (
            <li key={jail.name} className="px-5 py-2.5">
              <div className="flex flex-wrap items-center gap-3 text-sm">
                <span className="font-medium">{jail.name}</span>
                <span className="text-xs text-subtle">
                  şu an {jail.currentlyBanned} yasaklı · toplam {jail.totalBanned} · başarısız{" "}
                  {jail.totalFailed}
                </span>
              </div>
              {jail.bannedIps.length > 0 && (
                <ul className="mt-1 flex flex-wrap gap-1.5">
                  {jail.bannedIps.map((ip) => (
                    <li
                      key={ip}
                      className="flex items-center gap-1 rounded border border-line px-1.5 py-0.5 font-mono text-[11px]"
                    >
                      {ip}
                      {canManage && (
                        <button
                          type="button"
                          title="Yasağı kaldır"
                          onClick={async () => {
                            if (confirm(`${ip} yasağı kaldırılsın mı? (${jail.name})`)) {
                              const { data } = await api({ action: "unban", jail: jail.name, ip });
                              if (data.fail2ban) setState(data.fail2ban as Fail2banState);
                            }
                          }}
                          className="text-subtle transition-colors hover:text-brand"
                        >
                          <Check className="size-3" />
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}

      <div className="border-t border-line px-5 py-3">
        <h3 className="text-xs font-semibold text-subtle">
          Panel giriş denemeleri (son 7 gün)
        </h3>
        <p className="mt-0.5 text-[11px] text-subtle">
          fail2ban SSH&apos;ı izliyor; panelin web girişi ayrı bir yüzey ve kaydı yalnızca burada.
        </p>
        {failed.length === 0 ? (
          <p className="mt-2 text-sm text-ok">Başarısız giriş denemesi yok.</p>
        ) : (
          <ul className="mt-2 space-y-1">
            {failed.map((entry) => (
              <li key={`${entry.username}-${entry.ip}`} className="flex flex-wrap gap-3 text-xs">
                <span className="w-32 truncate font-mono">{entry.username || "(boş)"}</span>
                <span className="w-32 font-mono text-subtle">{entry.ip || "—"}</span>
                <span className={entry.attempts >= 5 ? "text-warn" : "text-subtle"}>
                  {entry.attempts} deneme
                </span>
                <span className="text-subtle">{when(entry.lastAt)}</span>
                <span className="min-w-0 flex-1 truncate text-subtle">{entry.lastDetail}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

/* ---------------- SSH anahtar denetimi ---------------- */

export function SshPanel() {
  const [audit, setAudit] = useState<SshAudit | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    setBusy(true);
    try {
      const response = await fetch("/api/security/monitor?mode=ssh", { cache: "no-store" });
      const data = (await response.json()) as { ssh: SshAudit };
      setAudit(data.ssh);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-lg border border-line bg-surface">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <KeyRound className="size-4 text-subtle" aria-hidden />
          SSH yetkili anahtarları
          {audit && <span className="font-normal text-subtle">{audit.keys.length} anahtar</span>}
        </h2>
        <button
          type="button"
          onClick={() => void load()}
          disabled={busy}
          className="flex items-center gap-1.5 rounded-md border border-line px-3 py-1.5 text-sm transition-colors hover:border-brand disabled:opacity-50"
        >
          <RotateCw className={`size-4 ${busy ? "animate-spin" : ""}`} />
          {audit ? "Yenile" : "Denetle"}
        </button>
      </div>

      {audit === null ? (
        <p className="px-5 py-8 text-center text-sm text-subtle">
          Bu sunucuya parolasız girebilen anahtarları listeler. Anahtarların kendisi değil,
          parmak izleri gösterilir.
        </p>
      ) : audit.error ? (
        <p className="px-5 py-6 text-sm text-danger">{audit.error}</p>
      ) : (
        <>
          <div className="border-b border-line px-5 py-2.5 text-xs">
            <span className="text-subtle">sshd: </span>
            parola girişi{" "}
            <strong
              className={
                audit.sshd.passwordAuthentication?.toLowerCase() === "yes" ? "text-warn" : "text-ok"
              }
            >
              {audit.sshd.passwordAuthentication ?? "varsayılan"}
            </strong>
            {" · "}root girişi <strong>{audit.sshd.permitRootLogin ?? "varsayılan"}</strong>
            {audit.sshd.port && ` · port ${audit.sshd.port}`}
          </div>

          {audit.notes.length > 0 && (
            <ul className="border-b border-line bg-warn/5 px-5 py-2">
              {audit.notes.map((note) => (
                <li key={note} className="flex items-start gap-1.5 text-xs text-warn">
                  <AlertTriangle className="mt-0.5 size-3 shrink-0" aria-hidden />
                  {note}
                </li>
              ))}
            </ul>
          )}

          <div className="overflow-x-auto">
            <table className="rtable w-full min-w-[40rem] text-xs">
              <thead className="border-b border-line text-left text-subtle">
                <tr>
                  <th className="px-5 py-2 font-medium">Hesap</th>
                  <th className="px-4 py-2 font-medium">Tür</th>
                  <th className="px-4 py-2 font-medium">Parmak izi</th>
                  <th className="px-4 py-2 font-medium">Yorum</th>
                  <th className="px-4 py-2 font-medium">Kısıt</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {audit.keys.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-5 py-6 text-center text-subtle">
                      Yetkili anahtar bulunamadı.
                    </td>
                  </tr>
                )}
                {audit.keys.map((key) => (
                  <tr key={key.fingerprint + key.owner}>
                    <td data-label="Hesap" className="px-5 py-1.5 font-mono">{key.owner}</td>
                    <td data-label="Tür" className="px-4 py-1.5 text-subtle">{key.type}</td>
                    <td data-label="Parmak izi" className="px-4 py-1.5 font-mono text-[11px]">{key.fingerprint}</td>
                    <td data-label="Yorum" className="max-w-xs truncate px-4 py-1.5 text-subtle">
                      {key.comment || "—"}
                    </td>
                    <td data-label="Kısıt" className="px-4 py-1.5">
                      {key.restricted ? (
                        <span className="text-ok">komuta kısıtlı</span>
                      ) : (
                        <span className="text-subtle">tam erişim</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}

/* ---------------- Port yönlendirmeleri ---------------- */

export function ForwardsPanel({
  initial,
  canManage,
}: {
  initial: PortForward[];
  canManage: boolean;
}) {
  const [forwards, setForwards] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  async function scan() {
    setBusy(true);
    setNotice("Yönlendiriciye soruluyor…");
    const { data } = await api({ action: "scan-upnp" });
    setNotice(String(data.message ?? ""));
    if (data.forwards) setForwards(data.forwards as PortForward[]);
    setBusy(false);
  }

  return (
    <section className="rounded-lg border border-line bg-surface">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <Router className="size-4 text-subtle" aria-hidden />
          Router port yönlendirmeleri
          <span className="font-normal text-subtle">{forwards.length}</span>
        </h2>
        {canManage && (
          <button
            type="button"
            onClick={() => void scan()}
            disabled={busy}
            className="flex items-center gap-1.5 rounded-md border border-line px-3 py-1.5 text-sm transition-colors hover:border-brand disabled:opacity-50"
          >
            <RotateCw className={`size-4 ${busy ? "animate-spin" : ""}`} /> Router&apos;a sor
          </button>
        )}
      </div>

      {notice && <p className="border-b border-line px-5 py-2 text-xs text-subtle">{notice}</p>}

      <p className="border-b border-line bg-brand/5 px-5 py-2 text-xs text-subtle">
        Yalnızca <strong>UPnP ile açılmış</strong> yönlendirmeler görünür. Router arayüzünden
        elle eklenmiş bir yönlendirme burada çıkmayabilir — boş liste &quot;hiç yönlendirme
        yok&quot; anlamına gelmez.
      </p>

      {forwards.length === 0 ? (
        <p className="px-5 py-8 text-center text-sm text-subtle">
          Kayıtlı yönlendirme yok.
        </p>
      ) : (
        <ul className="divide-y divide-line">
          {forwards.map((entry) => (
            <li key={entry.key} className="flex flex-wrap items-center gap-3 px-5 py-2.5">
              <span className="font-mono text-xs">
                {entry.protocol}/{entry.externalPort}
              </span>
              <span className="text-xs text-subtle">
                → {entry.internalHost}:{entry.internalPort}
              </span>
              <span className="min-w-0 flex-1 truncate text-xs">{entry.description || "—"}</span>
              {entry.note && <span className="text-xs text-brand">{entry.note}</span>}
              {!entry.acknowledged && (
                <span className="flex items-center gap-1 rounded bg-warn/15 px-1.5 py-0.5 text-[10px] font-medium text-warn">
                  <ShieldAlert className="size-3" aria-hidden /> onaylanmadı
                </span>
              )}
              <span className="text-[11px] text-subtle">ilk görülme {when(entry.firstSeen)}</span>
              {canManage && (
                <div className="flex gap-1">
                  <button
                    type="button"
                    title="Not ekle / bunu tanıyorum işaretle"
                    onClick={async () => {
                      const note = prompt("Bu yönlendirme ne için? (boş bırakılabilir)", entry.note);
                      if (note !== null) {
                        const { data } = await api({
                          action: "annotate-forward",
                          key: entry.key,
                          note,
                          acknowledged: true,
                        });
                        if (data.forwards) setForwards(data.forwards as PortForward[]);
                      }
                    }}
                    className="rounded border border-line px-2 py-1 text-[11px] text-subtle transition-colors hover:text-ink"
                  >
                    Not
                  </button>
                  <button
                    type="button"
                    title="Kaydı unut (router'daki yönlendirmeye dokunulmaz)"
                    onClick={async () => {
                      if (confirm(`${entry.key} kaydı listeden silinsin mi? Router'daki yönlendirmeye dokunulmaz.`)) {
                        const { data } = await api({ action: "forget-forward", key: entry.key });
                        if (data.forwards) setForwards(data.forwards as PortForward[]);
                      }
                    }}
                    className="rounded border border-line p-1.5 text-subtle transition-colors hover:text-danger"
                  >
                    <Trash2 className="size-3" />
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
