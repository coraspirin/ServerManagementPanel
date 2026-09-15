"use client";

import { useState } from "react";
import { Modal } from "@/components/Modal";
import { ComposeImportPanel } from "./ComposeImportPanel";
import { ImagePullPanel } from "./ImagePullPanel";
import { ContainerCreateForm } from "./ContainerCreateForm";
import { emptySpec, type ContainerSpec } from "@/lib/docker/spec";
import type { DockerOverview } from "@/lib/docker/types";

/**
 * "Konteyner Ekle" penceresi (M3.46).
 *
 * ## Neden popup, neden Container sekmesinde
 *
 * Container eklemek Container listesinin işi. Eskiden tek yol ayrı bir
 * ekrandaki compose yükleyicisiydi: kullanıcı container listesinden çıkıp
 * başka bir sayfaya gidiyor, oradan bir yığın kuruyor ve sonucu görmek için
 * geri dönüyordu. Düğme artık listenin kendi araç çubuğunda ve pencere
 * kapanınca liste güncel.
 *
 * ## İki kaynak, tek form
 *
 * Sekmeler yalnızca BAŞLANGIÇ noktası: compose dosyası ya da image adı.
 * İkisi de aynı `ContainerCreateForm`'u dolduruyor. Ayrı iki "oluştur" akışı
 * yazmak, port doğrulamasını iki yerde tutmak demekti.
 *
 * ## Hiçbir adım container yaratmıyor
 *
 * YAML okumak da, image çekmek de container OLUŞTURMUYOR. Pencerede tek bir
 * yaratma noktası var ve o da formun altındaki düğme. Kullanıcının açık
 * isteği buydu.
 */

type Kaynak = "compose" | "pull";

const SEKMELER: { id: Kaynak; label: string }[] = [
  { id: "compose", label: "Compose YAML" },
  { id: "pull", label: "Image çek" },
];

export function ContainerCreateDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  /** Oluşturma başarılı — güncel tablo ve kullanıcıya gösterilecek metin. */
  onCreated: (data: DockerOverview, message: string) => void;
}) {
  const [kaynak, setKaynak] = useState<Kaynak>("compose");

  /*
    `spec` null iken kaynak sekmeleri, dolu iken form görünüyor. Ayrı bir
    "adım" durumu tutmadık: formun açık olması TAM OLARAK elde bir tanım
    olması demek ve iki durumu ayrı tutmak, birinin diğerinden ayrışması
    demekti.
  */
  const [spec, setSpec] = useState<ContainerSpec | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);

  const kapat = () => {
    onClose();
    // Pencere kapanınca sıfırlanıyor: bir sonraki açılışta yarım kalmış bir
    // formla karşılaşmak, ne olduğu belirsiz bir başlangıç olurdu.
    setSpec(null);
    setWarnings([]);
    setKaynak("compose");
  };

  const hazir = (yeni: ContainerSpec, notlar: string[] = []) => {
    setSpec(yeni);
    setWarnings(notlar);
  };

  return (
    <Modal
      open={open}
      wide
      title={spec ? "Konteyner ayrıntıları" : "Konteyner ekle"}
      onClose={kapat}
    >
      {spec ? (
        <ContainerCreateForm
          spec={spec}
          warnings={warnings}
          onChange={setSpec}
          onCreated={(data, message) => {
            onCreated(data, message);
            kapat();
          }}
          onCancel={() => {
            setSpec(null);
            setWarnings([]);
          }}
        />
      ) : (
        <div className="space-y-4">
          <div className="flex gap-1 border-b border-line">
            {SEKMELER.map((sekme) => (
              <button
                key={sekme.id}
                type="button"
                onClick={() => setKaynak(sekme.id)}
                aria-current={kaynak === sekme.id ? "page" : undefined}
                className={`-mb-px border-b-2 px-3 py-2 text-sm transition-colors ${
                  kaynak === sekme.id
                    ? "border-brand font-medium text-brand"
                    : "border-transparent text-subtle hover:text-ink"
                }`}
              >
                {sekme.label}
              </button>
            ))}

            {/*
              Üçüncü bir sekme değil, bir kaçış kapısı: elinde ne YAML ne de
              hazır bir image adı olan kullanıcı da forma girebilmeli. Sekme
              yapmak, iki gerçek kaynağın yanında boş bir kutuyu eşit ağırlıkta
              göstermek olurdu.
            */}
            <button
              type="button"
              onClick={() => hazir(emptySpec())}
              className="ml-auto self-center text-xs text-subtle underline transition-colors hover:text-brand"
            >
              boş formla başla
            </button>
          </div>

          {kaynak === "compose" ? (
            <ComposeImportPanel onReady={hazir} />
          ) : (
            <ImagePullPanel onReady={(yeni) => hazir(yeni)} />
          )}
        </div>
      )}
    </Modal>
  );
}
