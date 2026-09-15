"use client";

import { useEffect, useState } from "react";
import { ChevronRight, Folder, FolderOpen, Plus, RotateCw, X } from "lucide-react";
import { Modal } from "@/components/Modal";

/**
 * Host klasör seçici (M3.45).
 *
 * ## Neden elle giriş kaldırıldı
 *
 * `appstore.stacks_dir` ve `files.roots` yola göre çalışan iki ayardı ve
 * ikisinde de yazım hatası SESSİZ bir arıza üretiyordu: yığın kurulumu dosyayı
 * yazıyor ama host `compose up`'ı reddediyor, dosya yöneticisi ise "bu yol
 * izinli kökler dışında" deyip duruyordu. Var olmayan bir klasörü seçmek
 * mümkün değilse bu hata sınıfı hiç doğmuyor.
 *
 * Yine de yol GÖRÜNÜYOR ve kopyalanabiliyor: seçici, kullanıcının nereye
 * yazdığını gizlemek için değil, doğru yazmasını sağlamak için var.
 *
 * Veri `/api/host/dirs` üzerinden geliyor ve YALNIZCA klasör adları dönüyor.
 */

type Listing = {
  path: string;
  parent: string | null;
  dirs: { name: string; path: string }[];
  error: string | null;
};

const inputClass =
  "w-full rounded-md border border-line bg-canvas px-2 py-1.5 text-sm outline-none focus:border-brand disabled:opacity-50";

/** "/opt/stacks" → ["/", "/opt", "/opt/stacks"] — kırıntı yolu. */
function crumbs(target: string): { label: string; path: string }[] {
  const parts = target.split("/").filter(Boolean);
  const out = [{ label: "/", path: "/" }];
  let acc = "";
  for (const part of parts) {
    acc += `/${part}`;
    out.push({ label: part, path: acc });
  }
  return out;
}

/**
 * Bir klasörün içeriğini çeker.
 *
 * Bileşenin DIŞINDA ve state'e dokunmuyor: hata durumları da bir `Listing`
 * olarak dönüyor, böylece çağıran tek bir `setListing` ile işini bitiriyor.
 * Ayrı ayrı durum güncelleyen bir yardımcı, React'ın "efekt içinde eşzamanlı
 * setState" kuralına takılıyordu.
 */
async function fetchListing(target: string): Promise<Listing> {
  try {
    const response = await fetch(`/api/host/dirs?path=${encodeURIComponent(target)}`, {
      cache: "no-store",
    });
    const payload = (await response.json()) as Listing & { error?: string };
    if (!response.ok) {
      return {
        path: target,
        parent: null,
        dirs: [],
        error: payload.error ?? "Klasör listesi alınamadı.",
      };
    }
    // Sunucu yolu normalleştirmiş olabilir; "hangi yolun listesi" sorusunun
    // cevabı istenen yol olmalı, yoksa yükleniyor durumu hiç kapanmaz.
    return { ...payload, path: target };
  } catch {
    return { path: target, parent: null, dirs: [], error: "Sunucuya ulaşılamadı." };
  }
}

/**
 * Gezinme penceresi. `onPick` seçilen mutlak yolu verir.
 *
 * Açılış klasörü, seçilmiş değerin KENDİSİ değil onun bulunduğu yer olsaydı
 * kullanıcı her açışta bir seviye yukarıdan başlardı; var olmayan bir yol
 * verilirse liste boş döner ve kırıntıdan yukarı çıkılabilir.
 */
export function DirBrowser({
  open,
  title,
  startPath,
  onPick,
  onClose,
}: {
  open: boolean;
  title: string;
  startPath: string;
  onPick: (path: string) => void;
  onClose: () => void;
}) {
  const [current, setCurrent] = useState(startPath || "/");
  const [listing, setListing] = useState<Listing | null>(null);
  /** Yenile düğmesinin jetonu: aynı yolu yeniden çekmenin tek yolu. */
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    if (!open) return;

    let alive = true;
    (async () => {
      const next = await fetchListing(current);
      // Kullanıcı yanıt gelmeden başka klasöre geçmiş olabilir; geç gelen
      // liste ekrandakini ezmemeli.
      if (alive) setListing(next);
    })();

    return () => {
      alive = false;
    };
  }, [open, current, reloadToken]);

  /*
    Yükleniyor durumu TÜRETİLİYOR, ayrı bir state değil: elimizdeki liste
    gösterilen yola ait değilse yolda bir istek var demektir. Ayrı bir bayrak
    tutmak, onu her çıkış yolunda kapatmayı unutma riskiydi.
  */
  const busy = listing === null || listing.path !== current;

  const reload = () => {
    setListing(null);
    setReloadToken((value) => value + 1);
  };

  // Pencere her açıldığında seçili değerden başla; önceki gezinme kalıntısı
  // "neredeyim" sorusunu doğuruyordu.
  const [openedWith, setOpenedWith] = useState(open);
  if (open !== openedWith) {
    setOpenedWith(open);
    if (open) setCurrent(startPath || "/");
  }

  return (
    <Modal open={open} title={title} onClose={onClose} wide>
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-0.5 rounded-md border border-line bg-canvas px-2 py-1.5 text-xs">
          {crumbs(current).map((crumb, index) => (
            <span key={crumb.path} className="flex items-center gap-0.5">
              {index > 0 && <ChevronRight className="size-3 text-subtle" aria-hidden />}
              <button
                type="button"
                onClick={() => setCurrent(crumb.path)}
                className="rounded px-1 py-0.5 font-mono transition-colors hover:bg-line/50 hover:text-brand"
              >
                {crumb.label}
              </button>
            </span>
          ))}
          <button
            type="button"
            onClick={reload}
            title="Yenile"
            className="ml-auto rounded p-1 text-subtle transition-colors hover:text-ink"
          >
            <RotateCw className={`size-3.5 ${busy ? "animate-spin" : ""}`} />
          </button>
        </div>

        {listing?.error && (
          <p className="rounded-md border border-warn/40 bg-warn/5 px-3 py-2 text-xs text-warn">
            {listing.error}
          </p>
        )}

        <div className="max-h-72 overflow-y-auto rounded-md border border-line">
          {listing && listing.dirs.length === 0 && !listing.error ? (
            <p className="px-3 py-6 text-center text-xs text-subtle">
              Burada alt klasör yok. Yine de bu klasörü seçebilirsin.
            </p>
          ) : (
            <ul className="divide-y divide-line">
              {listing?.dirs.map((dir) => (
                <li key={dir.path}>
                  <button
                    type="button"
                    onClick={() => setCurrent(dir.path)}
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm transition-colors hover:bg-line/40"
                  >
                    <Folder className="size-3.5 shrink-0 text-subtle" aria-hidden />
                    <span className="truncate font-mono text-xs">{dir.name}</span>
                    <ChevronRight className="ml-auto size-3.5 shrink-0 text-subtle" aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2">
          <span className="mr-auto min-w-0 truncate font-mono text-xs text-subtle">{current}</span>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-line px-3 py-1.5 text-sm text-subtle transition-colors hover:text-ink"
          >
            Vazgeç
          </button>
          <button
            type="button"
            onClick={() => onPick(current)}
            className="rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-white transition-opacity hover:opacity-90"
          >
            Bu klasörü seç
          </button>
        </div>
      </div>
    </Modal>
  );
}

/** Tek bir klasör yolu (ör. yığın kök dizini). */
export function DirPicker({
  value,
  disabled,
  onCommit,
}: {
  value: string;
  disabled: boolean;
  onCommit: (value: string) => void;
}) {
  const [browsing, setBrowsing] = useState(false);

  return (
    <div className="flex w-full items-center gap-1.5 sm:w-72">
      <span
        title={value}
        className={`${inputClass} min-w-0 truncate font-mono ${value ? "" : "text-subtle"}`}
      >
        {value || "seçilmedi"}
      </span>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setBrowsing(true)}
        title="Klasör seç"
        className="shrink-0 rounded-md border border-line p-1.5 text-subtle transition-colors hover:border-brand hover:text-brand disabled:opacity-50"
      >
        <FolderOpen className="size-4" />
      </button>

      <DirBrowser
        open={browsing}
        title="Klasör seç"
        startPath={value}
        onClose={() => setBrowsing(false)}
        onPick={(picked) => {
          setBrowsing(false);
          if (picked !== value) onCommit(picked);
        }}
      />
    </div>
  );
}

/**
 * Virgülle ayrılmış klasör listesi (ör. izinli kök dizinler).
 *
 * Depolama biçimi DEĞİŞMİYOR — `files.roots` hâlâ "/home,/mnt,/srv" — çünkü
 * `allowedRoots()` ve dışa aktarılan yapılandırma bu biçimi okuyor. Değişen
 * yalnızca girişin nasıl toplandığı.
 */
export function DirListEditor({
  value,
  disabled,
  onCommit,
}: {
  value: string;
  disabled: boolean;
  onCommit: (value: string) => void;
}) {
  const [browsing, setBrowsing] = useState(false);

  const list = value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);

  const write = (next: string[]) => onCommit([...new Set(next)].join(","));

  return (
    <div className="w-full space-y-1.5 sm:w-72">
      {list.length === 0 ? (
        <p className="text-xs text-warn">
          Hiç kök tanımlı değil — dosya yöneticisi kapalı.
        </p>
      ) : (
        <ul className="space-y-1">
          {list.map((entry) => (
            <li
              key={entry}
              className="flex items-center gap-1.5 rounded-md border border-line bg-canvas px-2 py-1"
            >
              <Folder className="size-3.5 shrink-0 text-subtle" aria-hidden />
              <span className="min-w-0 flex-1 truncate font-mono text-xs">{entry}</span>
              <button
                type="button"
                disabled={disabled}
                onClick={() => write(list.filter((item) => item !== entry))}
                aria-label={`${entry} kaldır`}
                className="shrink-0 rounded p-0.5 text-subtle transition-colors hover:text-danger disabled:opacity-50"
              >
                <X className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <button
        type="button"
        disabled={disabled}
        onClick={() => setBrowsing(true)}
        className="inline-flex items-center gap-1 rounded-md border border-line px-2 py-1 text-xs text-subtle transition-colors hover:border-brand hover:text-brand disabled:opacity-50"
      >
        <Plus className="size-3.5" aria-hidden />
        Klasör ekle
      </button>

      <DirBrowser
        open={browsing}
        title="İzinli kök ekle"
        startPath={list[0] ?? "/"}
        onClose={() => setBrowsing(false)}
        onPick={(picked) => {
          setBrowsing(false);
          write([...list, picked]);
        }}
      />
    </div>
  );
}
