import {
  Boxes,
  Clapperboard,
  Cloud,
  Cpu,
  Download,
  Gamepad2,
  Globe,
  HardDrive,
  Home,
  Image,
  Music,
  Newspaper,
  Router,
  ShieldCheck,
  Terminal,
  Wrench,
  type LucideIcon,
} from "lucide-react";

/**
 * Kategori ikonları için seçilmiş küçük bir liste (M2.4).
 *
 * Lucide'ın tamamı açılmıyor: bin küstür ikonluk bir ızgara seçmeyi
 * kolaylaştırmaz, zorlaştırır. Ayrıca serbest metin kabul edilseydi ikon adı
 * yanlış yazıldığında kategori ikonsuz kalır ve sebebi görünmezdi. Buradaki
 * anahtarlar veritabanına yazıldığı için DEĞİŞTİRİLMEMELİ; yeni ikon eklemek
 * serbest.
 */
export const CATEGORY_ICONS: Record<string, LucideIcon> = {
  Boxes,
  Home,
  Clapperboard,
  Music,
  Image,
  Download,
  Gamepad2,
  Newspaper,
  Cloud,
  HardDrive,
  Router,
  Globe,
  ShieldCheck,
  Terminal,
  Cpu,
  Wrench,
};

export const DEFAULT_CATEGORY_ICON = Boxes;

export function categoryIcon(name: string): LucideIcon {
  return CATEGORY_ICONS[name] ?? DEFAULT_CATEGORY_ICON;
}
