"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Layers, Power, Server } from "lucide-react";
import { CSRF_COOKIE, CSRF_HEADER } from "@/lib/auth/types";
import type { SystemdUnit } from "@/lib/host/helper";
import { ConsolePanel } from "./ConsolePanel";

type Stack = {
  project: string;
  workingDir: string | null;
  configFiles: string | null;
  services: { name: string; container: string; state: string; status: string }[];
};

function readCsrfToken(): string {
  const match = document.cookie.match(new RegExp(`(?:^|; )${CSRF_COOKIE}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : "";
}

async function callHost(path: string, body: unknown) {
  const response = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json", [CSRF_HEADER]: readCsrfToken() },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error ?? "İşlem başarısız.");
  return data;
}

/**
 * Sunucu yönetimi (M1.12 + M1.13).
 *
 * Buradaki her düğme host'ta bir komut çalıştırır — ama panel çalıştırmaz,
 * host'taki helper çalıştırır ve yalnızca izin listesindekileri. Bu yüzden
 * ekran "yetkin var" demiyor; "rica edildi, host ne dedi" diyor. İzin
 * listesinde olmayan bir eylem burada düğme olarak görünse bile reddedilir ve
 * sebebi yazılır.
 */
export function HostScreen({
  helperReady,
  canPower,
  canService,
  canShell,
  consoleMaxLines,
}: {
  helperReady: boolean;
  canPower: boolean;
  canService: boolean;
  canShell: boolean;
  consoleMaxLines: number;
}) {
  const [stacks, setStacks] = useState<Stack[] | null>(null);
  const [units, setUnits] = useState<SystemdUnit[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ kind: "ok" | "hata"; text: string } | null>(null);
  const [delayMinutes, setDelayMinutes] = useState(1);

  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      try {
        const response = await fetch("/api/host/compose", {
          signal: controller.signal,
          cache: "no-store",
        });
        const data = await response.json();
        if (response.ok) setStacks(data.stacks as Stack[]);
      } catch {
        // Ağ hatası: yığın listesi boş kalır, ekranın gerisi çalışır.
      }
    })();
    return () => controller.abort();
  }, []);

  async function run(key: string, fn: () => Promise<string>) {
    setBusy(key);
    setMessage(null);
    try {
      setMessage({ kind: "ok", text: await fn() });
    } catch (error) {
      setMessage({ kind: "hata", text: error instanceof Error ? error.message : "hata" });
    } finally {
      setBusy(null);
    }
  }

  if (!helperReady) {
    return (
      <div className="rounded-lg border border-warn/40 bg-surface px-5 py-4">
        <h2 className="flex items-center gap-2 font-semibold">
          <Server className="size-4" /> host-helper kurulu değil
        </h2>
        <p className="mt-2 text-sm text-subtle">
          Güç yönetimi, systemd ve compose komutları host&apos;ta çalışmak zorunda.
          Panel container&apos;ına root vermek yerine host&apos;ta küçük bir daemon
          çalışır; panel ona <em>rica eder</em>, ne çalıştırılacağına host&apos;taki
          izin listesi karar verir. O liste container&apos;a mount edilmez — panel ele
          geçirilse bile genişletilemez.
        </p>
        <pre className="mt-3 overflow-x-auto rounded border border-line bg-canvas p-3 font-mono text-[11px]">
{`# sunucuda, panel dizininde
sudo host-helper/install.sh

# çıktıdaki HELPER_SECRET satırını .env'e ekle
# docker-compose.yml'de /run/panel-helper mount satırının yorumunu kaldır
# /etc/panel-helper/allow.conf içinde izin verilecek satırları aç
docker compose up -d`}
        </pre>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {message && (
        <p
          className={`rounded-md border px-4 py-2 text-sm ${
            message.kind === "ok"
              ? "border-ok/40 text-ok"
              : "border-danger/40 text-danger"
          }`}
        >
          <span className="whitespace-pre-wrap font-mono text-xs">{message.text}</span>
        </p>
      )}

      {canShell && <ConsolePanel maxLines={consoleMaxLines} />}

      {canPower && (
        <section className="rounded-lg border border-danger/30 bg-surface">
          <div className="border-b border-line px-5 py-3">
            <h2 className="flex items-center gap-1.5 font-semibold">
              <Power className="size-4 text-danger" /> Güç
            </h2>
            <p className="mt-0.5 text-xs text-subtle">
              Kapatma geri alınamaz: uzaktaki bir sunucuyu kapatmak, fiziksel erişim
              olmadan geri getirilemez. Gecikme verirsen &quot;İptal&quot; ile
              vazgeçebilirsin.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3 px-5 py-3">
            <label className="flex items-center gap-1.5 text-xs text-subtle">
              gecikme
              <input
                type="number"
                min={0}
                max={1440}
                value={delayMinutes}
                onChange={(e) => setDelayMinutes(Number(e.target.value))}
                className="w-16 rounded-md border border-line bg-canvas px-2 py-1 text-sm outline-none focus:border-brand"
              />
              dk
            </label>

            <button
              type="button"
              disabled={busy !== null}
              onClick={() => {
                if (!confirm(`Sunucu ${delayMinutes} dakika sonra YENİDEN BAŞLATILACAK.`)) return;
                void run("reboot", async () => {
                  await callHost("/api/host", {
                    action: "power.reboot",
                    args: { delaySeconds: delayMinutes * 60 },
                  });
                  return `Yeniden başlatma ${delayMinutes} dk sonraya planlandı.`;
                });
              }}
              className="rounded-md border border-line px-3 py-1.5 text-sm transition-colors hover:border-warn hover:text-warn disabled:opacity-50"
            >
              Yeniden başlat
            </button>

            <button
              type="button"
              disabled={busy !== null}
              onClick={() => {
                if (
                  !confirm(
                    `Sunucu ${delayMinutes} dakika sonra KAPATILACAK.\n\n` +
                      "Uzaktan tekrar açmanın bir yolu yoksa panel bir daha erişilemez.",
                  )
                ) {
                  return;
                }
                void run("shutdown", async () => {
                  await callHost("/api/host", {
                    action: "power.shutdown",
                    args: { delaySeconds: delayMinutes * 60 },
                  });
                  return `Kapatma ${delayMinutes} dk sonraya planlandı.`;
                });
              }}
              className="rounded-md border border-danger/40 px-3 py-1.5 text-sm text-danger transition-colors hover:bg-danger/10 disabled:opacity-50"
            >
              Kapat
            </button>

            <button
              type="button"
              disabled={busy !== null}
              onClick={() =>
                void run("cancel", async () => {
                  await callHost("/api/host", { action: "power.cancel", args: {} });
                  return "Planlanmış güç işlemi iptal edildi.";
                })
              }
              className="rounded-md border border-line px-3 py-1.5 text-sm transition-colors hover:border-brand hover:text-brand disabled:opacity-50"
            >
              İptal
            </button>
          </div>
        </section>
      )}

      {canService && (
        <section className="rounded-lg border border-line bg-surface">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-5 py-3">
            <h2 className="flex items-center gap-1.5 font-semibold">
              <Server className="size-4" /> systemd birimleri
            </h2>
            <button
              type="button"
              disabled={busy !== null}
              onClick={() =>
                void run("units", async () => {
                  const data = await callHost("/api/host", { action: "service.list", args: {} });
                  setUnits(data.units as SystemdUnit[]);
                  return `${(data.units as SystemdUnit[]).length} birim listelendi.`;
                })
              }
              className="rounded-md border border-line px-2.5 py-1.5 text-xs transition-colors hover:border-brand hover:text-brand disabled:opacity-50"
            >
              {busy === "units" ? "yükleniyor…" : "Birimleri listele"}
            </button>
          </div>

          {units !== null && (
            <div className="max-h-80 overflow-auto px-5 py-3">
              <table className="rtable w-full text-sm">
                <tbody className="divide-y divide-line">
                  {units.map((unit) => (
                    <tr key={unit.unit}>
                      <td data-label="" className="py-1.5 font-mono text-[11px]">{unit.unit}</td>
                      <td data-label="" className="py-1.5">
                        <span
                          className={`text-xs ${
                            unit.active === "active"
                              ? "text-ok"
                              : unit.active === "failed"
                                ? "text-danger"
                                : "text-subtle"
                          }`}
                        >
                          {unit.active} / {unit.sub}
                        </span>
                      </td>
                      <td data-label="" className="py-1.5 text-right max-md:text-left">
                        <button
                          type="button"
                          disabled={busy !== null}
                          onClick={() => {
                            if (!confirm(`"${unit.unit}" yeniden başlatılsın mı?`)) return;
                            void run(unit.unit, async () => {
                              await callHost("/api/host", {
                                action: "service.restart",
                                args: { unit: unit.unit },
                              });
                              return `${unit.unit} yeniden başlatıldı.`;
                            });
                          }}
                          className="rounded border border-line px-2 py-0.5 text-[11px] text-subtle transition-colors hover:border-brand hover:text-brand disabled:opacity-40"
                        >
                          yeniden başlat
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      <section className="rounded-lg border border-line bg-surface">
        <div className="border-b border-line px-5 py-3">
          <h2 className="flex items-center gap-1.5 font-semibold">
            <Layers className="size-4" /> Compose yığınları
          </h2>
          <p className="mt-0.5 text-xs text-subtle">
            Yığınlar çalışan container&apos;ların compose etiketlerinden bulunur; ayrıca
            yol tanımlamak gerekmez. Komutlar host-helper üzerinden çalışır ve yalnızca
            izin listesindeki dizinlerde çalıştırılabilir.
          </p>
        </div>

        <div className="divide-y divide-line">
          {stacks === null ? (
            <p className="px-5 py-3 text-sm text-subtle">yükleniyor…</p>
          ) : stacks.length === 0 ? (
            <p className="px-5 py-3 text-sm text-subtle">Compose ile yönetilen yığın yok.</p>
          ) : (
            stacks.map((stack) => (
              <div key={stack.project} className="px-5 py-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-medium">{stack.project}</div>
                    <div className="truncate font-mono text-[11px] text-subtle">
                      {stack.workingDir ?? "dizin etiketi yok"}
                    </div>
                    <div className="mt-0.5 text-xs text-subtle">
                      {stack.services
                        .map((service) => `${service.name} (${service.state})`)
                        .join(" · ")}
                    </div>
                  </div>

                  {/*
                    Yığın komutları (Çek/Uygula/Yeniden başlat) buradan
                    KALDIRILDI (M3.37): aynı düğmeler Docker ekranının Stack
                    sekmesinde, yığının üyeleri ve compose düzenleyicisiyle
                    birlikte duruyor. Aynı işi yapan iki düğme takımını iki
                    yerde bakımda tutmak, zamanla ayrışmaları demek.

                    Bu bölüm kalıyor çünkü gösterdiği şey host'a ait: yığının
                    hangi dizinden çalıştığı ve host-helper'ın durumu.
                  */}
                  <Link
                    href="/docker?tab=stack"
                    className="shrink-0 rounded border border-line px-2 py-1 text-[11px] text-subtle transition-colors hover:border-brand hover:text-brand"
                  >
                    Stack sekmesinde yönet
                  </Link>
                </div>
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  );
}
