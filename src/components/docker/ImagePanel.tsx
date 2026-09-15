"use client";

import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Info, Trash2 } from "lucide-react";

import { formatBytes } from "@/lib/metrics/catalog";
import type { DockerImage } from "@/lib/providers/types";
// Referans ayrıştırması ortak modülde (M3.39); burada bir kopyası vardı.
import { splitReference } from "@/lib/docker/reference";

/**
 * Image listesi — DEPOYA GÖRE GRUPLANMIŞ (M3.24).
 *
 * Önceden düz bir listeydi ve aynı imajın beş sürümü beş ayrı satır olarak,
 * aralarında hiçbir görsel bağ olmadan duruyordu. Asıl sorulan soru
 * "postgres'in kaç sürümü var ve hangileri kullanılmıyor" iken cevabı bulmak
 * için listeyi gözle taramak gerekiyordu.
 *
 * Artık depo başlığı toplam boyutu ve kullanılmayan sürüm sayısını söylüyor;
 * ayrıntı isteyen satırı açıyor.
 */

export type ImageGroup = {
  repo: string;
  images: DockerImage[];
  totalBytes: number;
  unused: number;
};

function shortId(id: string): string {
  return id.replace(/^sha256:/, "").slice(0, 12);
}

export function groupImages(images: DockerImage[]): ImageGroup[] {
  const byRepo = new Map<string, DockerImage[]>();

  for (const image of images) {
    // Etiketi kalmamış (sarkan) image'lar tek bir kovada toplanıyor: her biri
    // ayrı başlık olsaydı liste 29 anlamsız satırla dolardı.
    const repo = image.tags.length > 0 ? splitReference(image.tags[0]).repo : "<etiketsiz>";
    const list = byRepo.get(repo);
    if (list) list.push(image);
    else byRepo.set(repo, [image]);
  }

  return [...byRepo.entries()]
    .map(([repo, list]) => ({
      repo,
      images: [...list].sort((a, b) => b.createdAt - a.createdAt),
      totalBytes: list.reduce((total, image) => total + image.sizeBytes, 0),
      unused: list.filter((image) => image.usedBy.length === 0).length,
    }))
    .sort((a, b) => {
      // Etiketsizler en sona: bir depo değil, artıkların kovası.
      if ((a.repo === "<etiketsiz>") !== (b.repo === "<etiketsiz>")) {
        return a.repo === "<etiketsiz>" ? 1 : -1;
      }
      return a.repo.localeCompare(b.repo, "tr");
    });
}

export function ImagePanel({
  images,
  canAct,
  busyId,
  onRemove,
  onDetail,
}: {
  images: DockerImage[];
  canAct: boolean;
  busyId: string | null;
  onRemove: (id: string, label: string) => void;
  onDetail: (image: DockerImage) => void;
}) {
  const groups = useMemo(() => groupImages(images), [images]);
  const [acik, setAcik] = useState<Set<string>>(new Set());

  const toggle = (repo: string) =>
    setAcik((prev) => {
      const next = new Set(prev);
      if (next.has(repo)) next.delete(repo);
      else next.add(repo);
      return next;
    });

  if (groups.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-line bg-surface px-5 py-8 text-center text-sm text-subtle">
        Kayıt yok.
      </p>
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border border-line bg-surface">
      <ul className="divide-y divide-line">
        {groups.map((group) => {
          const genis = acik.has(group.repo);

          return (
            <li key={group.repo}>
              <button
                type="button"
                onClick={() => toggle(group.repo)}
                aria-expanded={genis}
                className="flex w-full flex-wrap items-center gap-2 px-3 py-2.5 text-left transition-colors hover:bg-canvas"
              >
                {genis ? (
                  <ChevronDown className="size-3.5 shrink-0 text-subtle" aria-hidden />
                ) : (
                  <ChevronRight className="size-3.5 shrink-0 text-subtle" aria-hidden />
                )}

                <span className="min-w-0 flex-1 truncate font-mono text-sm">{group.repo}</span>

                {group.unused > 0 && (
                  <span className="rounded bg-warn/15 px-1.5 py-0.5 text-[10px] font-medium text-warn">
                    {group.unused === group.images.length
                      ? "kullanılmıyor"
                      : `${group.unused} sürüm kullanılmıyor`}
                  </span>
                )}

                <span className="shrink-0 text-xs text-subtle">
                  {group.images.length} sürüm · {formatBytes(group.totalBytes)}
                </span>
              </button>

              {genis && (
                <div className="overflow-x-auto border-t border-line bg-canvas/50">
                  <table className="w-full min-w-[40rem] text-xs">
                    <thead>
                      <tr className="text-left text-[11px] text-subtle">
                        <th className="px-3 py-1.5 font-medium">Etiket</th>
                        <th className="px-3 py-1.5 font-medium">ID</th>
                        <th className="px-3 py-1.5 font-medium">Boyut</th>
                        <th className="px-3 py-1.5 font-medium">Oluşturma</th>
                        <th className="px-3 py-1.5 font-medium">Kullanan</th>
                        <th className="px-3 py-1.5 text-right font-medium">İşlem</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line">
                      {group.images.map((image) => {
                        const etiketler = image.tags.map((tag) => splitReference(tag).tag);

                        return (
                          <tr key={image.id}>
                            <td className="px-3 py-1.5 font-mono">
                              {etiketler.length > 0 ? etiketler.join(", ") : "—"}
                            </td>
                            <td className="px-3 py-1.5 font-mono text-subtle">
                              {shortId(image.id)}
                            </td>
                            <td className="px-3 py-1.5">{formatBytes(image.sizeBytes)}</td>
                            <td className="px-3 py-1.5 text-subtle">
                              {image.createdAt > 0
                                ? new Date(image.createdAt * 1000).toLocaleDateString("tr-TR")
                                : "—"}
                            </td>
                            <td className="px-3 py-1.5">
                              {image.usedBy.length === 0 ? (
                                <span className="rounded bg-warn/15 px-1.5 py-0.5 text-[10px] font-medium text-warn">
                                  kullanılmıyor
                                </span>
                              ) : (
                                <span className="text-subtle">{image.usedBy.join(", ")}</span>
                              )}
                            </td>
                            <td className="px-3 py-1.5">
                              <div className="flex items-center justify-end gap-1">
                                <button
                                  type="button"
                                  title="Katmanlar ve yapılandırma"
                                  onClick={() => onDetail(image)}
                                  className="rounded border border-line p-1 text-subtle transition-colors hover:text-brand"
                                >
                                  <Info className="size-3" />
                                </button>

                                {canAct && image.usedBy.length === 0 && (
                                  <button
                                    type="button"
                                    title="Sil"
                                    disabled={busyId === image.id}
                                    onClick={() =>
                                      onRemove(
                                        image.id,
                                        image.tags[0] ?? `<etiketsiz> ${shortId(image.id)}`,
                                      )
                                    }
                                    className="rounded border border-line p-1 text-subtle transition-colors hover:border-danger hover:text-danger disabled:opacity-40"
                                  >
                                    <Trash2 className="size-3" />
                                  </button>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
