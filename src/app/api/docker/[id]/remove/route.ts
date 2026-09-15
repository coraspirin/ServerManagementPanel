import { guardApi } from "@/lib/auth/api";
import { audit } from "@/lib/auth/audit";
import { dockerOverview } from "@/lib/docker/view";
import { getDockerProvider } from "@/lib/providers";

export const dynamic = "force-dynamic";

/**
 * Container silme.
 *
 * `[id]/action` route'una eklenmedi: orası `provider.action(id, action,
 * timeout)` imzasına bağlı, `removeContainer(id, force)` ise farklı bir imza.
 * Aynı dosyada dallanmak "hangi eylem hangi fonksiyona gidiyor" sorusunu
 * okunmaz hale getirirdi.
 *
 * Prune'dan (M1.7) da ayrı: prune "kullanılmayan her şeyi" siler, bu ise
 * kullanıcının tek tek seçtiğini. Bir yığın kaldırıldıktan sonra geride kalan
 * TEK container'ı temizlemek için bütün durmuş container'ları silmek gerekmesin
 * diye var.
 *
 * `force` istemciden gelmiyor. Çalışan bir container'ı silmek onu önce
 * öldürmek demek ve bu, tek tıkla verilecek bir karar değil — kullanıcı önce
 * durdurur. Docker çalışan container'ı `force` olmadan zaten reddeder; o hata
 * olduğu gibi kullanıcıya gösteriliyor.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await guardApi(request, "docker.action");
  if (!guard.ok) return guard.response;

  const id = (await params).id;

  try {
    await getDockerProvider().removeContainer(id, false);
  } catch (error) {
    const message = error instanceof Error ? error.message : "bilinmeyen hata";
    audit({
      userId: guard.session.user.id,
      username: guard.session.user.username,
      action: "docker.remove_container",
      targetId: id,
      detail: message,
      result: "error",
    });
    return Response.json({ error: message }, { status: 500 });
  }

  audit({
    userId: guard.session.user.id,
    username: guard.session.user.username,
    action: "docker.remove_container",
    targetId: id,
    result: "ok",
  });

  return Response.json({ ok: true, ...(await dockerOverview()) });
}
