"use client";

import { useEffect, useState } from "react";

import type { Dependency } from "@/lib/docker/graph";
import type { Runbook } from "@/lib/docker/runbooks";
import type { ContainerDetail } from "@/lib/providers/types";

export type DetailPayload = {
  detail: ContainerDetail;
  impact: Dependency[];
  runbook: Runbook | null;
  raw: unknown;
};

/**
 * Container detayı — sekmelerin ORTAK kaynağı (M3.20).
 *
 * Çağrı çekmecede bir kez yapılıp sekmelere aktarılıyor. Alternatifi her
 * sekmenin kendi isteğini atmasıydı; sekme değiştirmek o zaman ağ trafiği
 * üretirdi ve aynı container'ın iki sekmesi birbirini tutmayan veri
 * gösterebilirdi.
 */
export function useContainerDetail(containerId: string | null) {
  /**
   * Sonuç, ait olduğu container'ın kimliğiyle BİRLİKTE tutuluyor.
   *
   * Ayrı `data`/`error` state'leri kullanıp container değişince efektin içinde
   * sıfırlamak, React'in "efekt gövdesinde senkron setState" kuralını ihlal
   * ediyordu. Kimliği veriyle beraber saklayınca sıfırlama gereksizleşiyor:
   * eski container'ın verisi eşleşmediği için zaten görünmüyor.
   */
  const [result, setResult] = useState<{
    id: string;
    data: DetailPayload | null;
    error: string | null;
  } | null>(null);

  useEffect(() => {
    if (!containerId) return;

    const controller = new AbortController();
    (async () => {
      try {
        const response = await fetch(`/api/docker/${encodeURIComponent(containerId)}/detail`, {
          signal: controller.signal,
          cache: "no-store",
        });
        const payload = await response.json();
        setResult(
          response.ok
            ? { id: containerId, data: payload as DetailPayload, error: null }
            : { id: containerId, data: null, error: payload.error ?? "Detay alınamadı." },
        );
      } catch {
        if (!controller.signal.aborted) {
          setResult({ id: containerId, data: null, error: "Sunucuya ulaşılamadı." });
        }
      }
    })();

    return () => controller.abort();
  }, [containerId]);

  const taze = result !== null && result.id === containerId;
  return { data: taze ? result.data : null, error: taze ? result.error : null };
}

/**
 * Host'ta gerçekten dinlenen portlar (M3.17).
 *
 * ÖNBELLEKTEN okunuyor (`refresh` YOK): detay penceresini açmak, host ad
 * alanında bir container açmayı hak etmez. `security.view` izni olmayan bir
 * kullanıcıda uç 403 döner ve rozet hiç gösterilmez — hata basmıyoruz, çünkü
 * bu bilgi pencerenin asıl işi değil.
 */
export function useListeningPorts(enabled: boolean) {
  const [listening, setListening] = useState<Set<number> | null>(null);

  useEffect(() => {
    if (!enabled) return;

    const controller = new AbortController();
    (async () => {
      try {
        const response = await fetch("/api/ports", {
          signal: controller.signal,
          cache: "no-store",
        });
        if (!response.ok) return;
        const payload = (await response.json()) as {
          ports: { port: number }[];
          updatedAt: number | null;
        };
        if (payload.updatedAt === null) return;
        setListening(new Set(payload.ports.map((entry) => entry.port)));
      } catch {
        // Sessiz: rozet gösterilmez, pencerenin geri kalanı çalışır.
      }
    })();

    return () => controller.abort();
  }, [enabled]);

  return listening;
}
