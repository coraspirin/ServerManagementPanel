import type { ContainerSummary } from "@/lib/providers/types";

/** Arayüzün gördüğü container satırı (M1.6). İstemci de kullanır. */
export type ContainerView = ContainerSummary & {
  cpuPct: number | null;
  memUsed: number | null;
  memPct: number | null;
  restartCount: number | null;
  /**
   * Container başlangıcından beri TOPLAM ağ/disk baytı (M3.24).
   *
   * Hız değil toplam: `docker stats`'in gösterdiğiyle aynı büyüklük ve tabloda
   * anlaşılması kolay. Zaman içindeki değişimi görmek isteyen, popup'ın
   * Kaynaklar sekmesindeki grafiklere bakıyor — orada hıza çevriliyor.
   */
  netRx: number | null;
  netTx: number | null;
  blkRead: number | null;
  blkWrite: number | null;
  /** Son pencerede kaç kez yeniden başladı — 0'dan büyükse sinsi arıza. */
  restartsInWindow: number | null;
  restartLoopWindowMinutes: number;
  /** `panel.order` etiketi — yığın içi gösterim sırası (M3.27). */
  order: number;
  /**
   * Panelin emniyet kilidi altındaki container (M3.30).
   *
   * Panelin kendisi ve reverse proxy: ikisi de panelin çalışmasını taşıyor.
   * Panel kendini durdurursa işlem süreç ortasında ölür, proxy durursa panele
   * ulaşan yol kapanır — ikisi de tek tıkla verilecek kararlar değil.
   *
   * Toplu işlemde işaretlenemiyorlar; tek tek işlemler açık kalıyor, çünkü
   * orada niyet açık ve onay metni container'ın adını söylüyor. Kilitlenen
   * asıl şey, kalabalık bir seçimin içinde kazara sürüklenmek.
   *
   * SUNUCUDA hesaplanıyor: ad `PANEL_CONTAINER_NAME` ortam değişkeninden ve
   * `proxy.caddy_container` ayarından geliyor, ikisi de istemcide yok.
   */
  locked: boolean;
};

export type DockerOverview = {
  containers: ContainerView[];
  /** Docker'a hiç erişilemediyse sebebi. */
  error: string | null;
  /** Ölçümlerin ne kadar taze olduğu. */
  statsAt: number | null;
};

export type { ContainerSummary };
