import { enterHost, guardHostApi } from "@/lib/auth/api";
import { listStacks } from "@/lib/appstore/install";
import { buildStacks } from "@/lib/docker/stacks";
import { dockerOverview } from "@/lib/docker/view";
import { helperConfigured } from "@/lib/host/helper";

export const dynamic = "force-dynamic";

/**
 * Yığın listesi (M3.37).
 *
 * ⚠️ YALNIZCA LİSTE üretir. Yığın işlemleri
 * [`/api/host/compose`](../../host/compose/route.ts)'ta, kurulum ve kayıt
 * kaldırma [`/api/appstore`](../../appstore/route.ts)'da kalıyor.
 *
 * Bunları buraya taşımak cazipti — tek ekran, tek uç — ama `installComposeStack`
 * diske compose dosyası yazan TEK yol ve çalışan, sınanmış bir boru hattı
 * (yaz → `compose config` ile doğrula → `compose up`). Ekranı taşımak için
 * altındaki yazma yolunu yeniden bağlamak, hiçbir şey kazandırmayan bir
 * regresyon riski olurdu.
 *
 * Container listesi `dockerOverview()` üzerinden geliyor: ölçümler (CPU,
 * bellek) orada metrik hattından okunuyor ve yığın toplamları onlara dayanıyor.
 * Ayrıca `panel.hidden` süzgeci de orada — gizlenen bir container yığın
 * sayısına da girmiyor, iki ekran aynı gerçeği göstersin.
 */
export async function GET(request: Request) {
  const guard = await guardHostApi(request, "docker.view");
  if (!guard.ok) return guard.response;
  enterHost(guard.hostId);

  const overview = await dockerOverview();
  if (overview.error) {
    return Response.json({ error: overview.error }, { status: 502 });
  }

  return Response.json({
    stacks: buildStacks(overview.containers, listStacks()),
    containers: overview.containers,
    helperReady: helperConfigured(),
  });
}
