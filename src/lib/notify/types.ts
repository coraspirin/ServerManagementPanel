import type { Severity } from "@/lib/alerts/types";

export type NotifyMessage = {
  severity: Severity;
  title: string;
  detail: string;
};

export interface NotifyChannel {
  /** Ayar anahtarlarındaki kimlik: `notify.<key>.*` */
  key: string;
  label: string;
  /**
   * Ayarları eksikse sorunu anlatan bir metin döner, tamamsa null.
   * Kanal "etkin" işaretlenip token'ı boş bırakıldığında sessizce çalışmamak
   * yerine bunu Ayarlar/Olaylar ekranında söyleyebilmek için var.
   */
  problem(): string | null;
  send(message: NotifyMessage): Promise<void>;
}
