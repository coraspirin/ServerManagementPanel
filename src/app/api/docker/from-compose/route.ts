import { guardApi } from "@/lib/auth/api";
import { parseCompose, readAllServices } from "@/lib/compose/service";
import { specFromService } from "@/lib/docker/spec";
import { serverT } from "@/lib/i18n/runtime";
import type { ContainerSpec } from "@/lib/docker/spec";

export const dynamic = "force-dynamic";

/**
 * Compose metnini container tanımlarına çevirir (M3.46).
 *
 * ## Neden sunucuda
 *
 * Ayrıştırma saf bir işlem ve tarayıcıda da çalışabilirdi; `yaml` paketini
 * istemci paketine sokmamak için burada duruyor. Panelin compose okuyan her
 * yeri (yığın düzenleyici, ön kontrol, compose üretici) zaten sunucuda
 * ayrıştırıyor — ikinci bir ayrıştırıcı öğretmenin anlamı yok.
 *
 * ## Hiçbir şey OLUŞTURMUYOR
 *
 * Bu uç yalnızca OKUR: ne container yaratır ne dosya yazar. Kullanıcının
 * yüklediği YAML, formu dolduracak veriye çevrilip geri gönderilir; container
 * ancak `/api/docker/create`'e gidilince var olur. `docker.action` izni yine
 * de isteniyor çünkü dönen tanım (ortam değişkenleri, volume yolları)
 * sunucunun yapılandırması hakkında bilgi taşıyor.
 *
 * ## Neden TÜM servisler dönüyor
 *
 * Çok servisli bir compose dosyasında hangisinin isteneceğini sunucu bilemez.
 * Liste dönüyor, seçimi kullanıcı yapıyor; tek servis varsa istemci onu
 * doğrudan açıyor.
 */

/** `install.ts`'teki sınırla aynı: 256 KB bir compose dosyası için fazlasıyla yeterli. */
const MAX_COMPOSE_BYTES = 256 * 1024;

export type ComposeImportService = {
  /** Compose'daki servis adı. */
  service: string;
  spec: ContainerSpec;
  /** Container'a taşınamayan tanımlar (port aralığı, değişkenli port…). */
  warnings: string[];
};

export async function POST(request: Request) {
  const guard = await guardApi(request, "docker.action");
  if (!guard.ok) return guard.response;

  let compose = "";
  try {
    compose = String(((await request.json()) as { compose?: unknown }).compose ?? "");
  } catch {
    return Response.json({ error: serverT("common.errors.invalidBody") }, { status: 400 });
  }

  if (!compose.trim()) {
    return Response.json({ error: serverT("api.compose.empty") }, { status: 400 });
  }

  // Uzunluk BAYT olarak ölçülüyor: Türkçe karakterler iki bayt ve karakter
  // sayısına bakan bir sınır dosyayı olduğundan küçük gösterirdi.
  if (new TextEncoder().encode(compose).length > MAX_COMPOSE_BYTES) {
    return Response.json(
      { error: serverT("api.compose.tooLarge") },
      { status: 400 },
    );
  }

  const { doc, error } = parseCompose(compose);
  if (!doc) return Response.json({ error: serverT("api.compose.yamlError", { error: String(error) }) }, { status: 400 });

  const services = readAllServices(doc);
  if (services.length === 0) {
    return Response.json(
      { error: serverT("api.compose.noServices") },
      { status: 400 },
    );
  }

  const result: ComposeImportService[] = services.map((service) => {
    const { spec, warnings } = specFromService(service, serverT);
    return { service: service.name, spec, warnings };
  });

  return Response.json({ services: result });
}
