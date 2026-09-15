/**
 * M2.6 — servis widget'ları, paylaşılan tipler.
 *
 * `server-only` YOK: kart bileşeni de bu tipleri kullanır.
 *
 * Widget'lar veriyi **panelin kendi biçiminde** döndürür (istatistik + satır),
 * her servisin ham JSON'unu değil. Sebep: kart ızgarasında Pi-hole, Jellyfin
 * ve qBittorrent yan yana duracak ve hepsinin aynı görünmesi gerekiyor. Ham
 * veriyi arayüze taşısaydık her servis için ayrı bir bileşen yazmak ve
 * hepsini ayrı ayrı biçimlendirmek gerekirdi.
 */

export type WidgetTone = "ok" | "warn" | "danger" | "neutral";

/** Kartın altında yan yana duran büyük sayılar. En fazla üç tane sığıyor. */
export type WidgetStat = {
  label: string;
  value: string;
  tone?: WidgetTone;
};

/** Detay satırı (kart açıldığında görünür): "En çok engellenen · ads.example". */
export type WidgetLine = {
  label: string;
  value: string;
};

export type WidgetData = {
  stats: WidgetStat[];
  lines: WidgetLine[];
  /** Durum cümlesi — "engelleme 4 dk kapalı" gibi. */
  note: string | null;
  /** Şu an anlamlı olan aksiyonların anahtarları. */
  availableActions: string[];
};

export type WidgetActionDef = {
  key: string;
  label: string;
  /** Doldurulmuşsa kullanıcıya bu metinle onay sorulur. */
  confirm?: string;
};

export type WidgetFieldDef = {
  key: string;
  label: string;
  /** `secret` alanlar T3 ile şifreli saklanır ve arayüze geri DÖNMEZ. */
  type: "string" | "secret";
  help?: string;
  required?: boolean;
  placeholder?: string;
};

export type WidgetDef = {
  key: string;
  label: string;
  help: string;
  fields: WidgetFieldDef[];
  actions: WidgetActionDef[];
};

/** Sağlayıcıya verilen bağlam. `baseUrl` kartın panel içi adresidir. */
export type WidgetContext = {
  baseUrl: string;
  config: Record<string, string>;
};

export interface WidgetProvider {
  def: WidgetDef;
  load(context: WidgetContext): Promise<WidgetData>;
  /** Aksiyon sonucu kullanıcıya gösterilecek kısa cümle döner. */
  act(action: string, context: WidgetContext): Promise<string>;
}

/** Kartın widget durumu — ekranın ihtiyaç duyduğu her şey tek nesnede. */
export type WidgetState =
  | { status: "ok"; data: WidgetData; updatedAt: number; stale: boolean }
  | { status: "error"; message: string; updatedAt: number | null };
