import "server-only";

import { getDockerProvider } from "@/lib/providers";
import { specProblem, toCreatePayload, type ContainerSpec } from "./spec";

/**
 * Container oluşturma (M3.46).
 *
 * ## Neden şimdiye kadar yoktu
 *
 * Panelde container ayağa kaldırmanın tek yolu compose'du. Bu, tek servislik
 * bir uygulama için gereksiz ağırlıktı: kullanıcı bir YAML yazmak, onu
 * host'un izin verdiği bir dizine kurdurmak ve host-helper'ın `compose up`
 * çalıştırmasını beklemek zorundaydı. Sağlayıcıda `createContainer` zaten
 * vardı ama yalnızca panelin İÇ işleri kullanıyordu (image güncelleme, geçici
 * volume container'ları).
 *
 * ## Neden `docker run` taklidi değil
 *
 * Engine'in kendisi `run` diye bir uç sunmuyor; `docker run` istemcinin
 * create + start (+ gerekirse pull) dizisi. Burada da öyle, ve adımlar AYRI
 * raporlanıyor: "container oluşturuldu ama başlamadı" ile "container hiç
 * oluşmadı" kullanıcı için tamamen farklı iki durum — ilkinde kayıt duruyor,
 * loglarına bakılabiliyor.
 *
 * ## Başlatma başarısız olursa container SİLİNMİYOR
 *
 * İlk tasarım geri alıyordu. Yanlıştı: başlatma hatalarının çoğu (port dolu,
 * volume yolu yok, imaj mimarisi uymuyor) container'ın loglarında ya da
 * inspect çıktısında yazıyor ve container silinince o kanıt da gidiyordu.
 * Kayıt duruyor, panel ne olduğunu söylüyor, kullanıcı düzeltip başlatıyor.
 */

export type CreateResult = {
  id: string;
  name: string;
  /** Başlatma istendi mi ve başarılı oldu mu. */
  started: boolean;
  /**
   * Oluşturma başarılı ama sonraki adımlardan biri değilse buradadır.
   * Container KAYDI durur — çağıran bunu hata değil uyarı olarak göstermeli.
   */
  warnings: string[];
};

export async function createContainerFromSpec(spec: ContainerSpec): Promise<CreateResult> {
  const problem = specProblem(spec);
  if (problem) throw new Error(problem);

  const provider = getDockerProvider();
  const name = spec.name.trim();
  const warnings: string[] = [];

  /*
    İmaj yerelde yoksa ÖNCE çekiliyor.

    Engine `/containers/create` eksik imajda 404 döndürüyor ve mesajı
    ("No such image: ...") kullanıcıya bir sonraki adımı söylemiyor. Pull'u
    burada yapmak, "Image çek" sekmesinden geçmeden doğrudan form dolduran
    kullanıcıyı da kapsıyor.

    Çekme çıktısı YUTULUYOR: bu fonksiyonun yanıtı akış değil. İlerlemeyi
    görmek isteyen "Image çek" sekmesini kullanıyor.
  */
  const images = await provider.images().catch(() => []);
  const reference = spec.image.trim();
  const present = images.some(
    (image) => image.tags.includes(reference) || image.id.startsWith(reference),
  );

  if (!present) {
    try {
      // Akış sonuna kadar tüketiliyor; bitmesi indirmenin bitmesi demek.
      const progress = provider.pullImage(reference);
      while (!(await progress.next()).done) {
        /* ilerleme yok sayılıyor */
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "image çekilemedi";
      throw new Error(`Image çekilemedi (${reference}): ${message}`);
    }
  }

  const id = await provider.createContainer(name, toCreatePayload(spec));

  /*
    İlk ağ `NetworkMode` ile verildi; kalanlar burada bağlanıyor. Engine tek
    bir create çağrısında yalnızca bir ağ kabul ediyor ve ikincisini sessizce
    yok sayıyor — kullanıcı üç ağ seçip tek ağa bağlı bir container alırdı.
  */
  for (const network of spec.networks.slice(1)) {
    try {
      await provider.connectNetwork(network, id, {});
    } catch (error) {
      const message = error instanceof Error ? error.message : "bilinmeyen hata";
      warnings.push(`"${network}" ağına bağlanamadı: ${message}`);
    }
  }

  if (!spec.autoStart) return { id, name, started: false, warnings };

  try {
    // Üçüncü argüman durdurma zaman aşımı; başlatmada kullanılmıyor ama
    // imza zorunlu kılıyor.
    await provider.action(id, "start", 10);
    return { id, name, started: true, warnings };
  } catch (error) {
    const message = error instanceof Error ? error.message : "bilinmeyen hata";
    warnings.push(
      `Container oluşturuldu ama başlatılamadı: ${message}. ` +
        "Kayıt duruyor — loglarına bakıp düzelttikten sonra listeden başlatabilirsin.",
    );
    return { id, name, started: false, warnings };
  }
}
