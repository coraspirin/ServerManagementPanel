import { requirePermission } from "@/lib/auth/guard";
import { hasPermission } from "@/lib/auth/session";
import { listDirectory } from "@/lib/files/browse";
import { allowedRoots } from "@/lib/files/paths";
import { FilesScreen } from "./FilesScreen";

export const dynamic = "force-dynamic";

/** Dosya yöneticisi + disk analizi + temizlik asistanı (M3.5). */
export default async function FilesPage({
  searchParams,
}: {
  searchParams: Promise<{ path?: string }>;
}) {
  const session = await requirePermission("files.read");
  const roots = allowedRoots();

  // İlk açılışta ilk izinli kökten başlanır. `/` neredeyse hiçbir zaman
  // izinli değil ve oradan başlamak boş bir hata ekranı gösterirdi.
  const varsayilan = roots[0] ?? "/";

  /*
    `?path=` ile doğrudan bir klasöre açılabiliyor (M3.33): volume detayındaki
    "Gözat" bağlantısı volume'ün host yolunu buraya veriyor.

    İZİN KONTROLÜ YAPILMIYOR, çünkü gerekmiyor: `listDirectory` izinli kökler
    dışındaki her yolu zaten reddediyor. Burada ikinci bir kontrol yazmak,
    ikisinin zamanla ayrışabileceği bir kopya olurdu — istenen yol izinsizse
    aşağıdaki catch varsayılan köke düşürüyor.
  */
  const istenen = (await searchParams).path?.trim();
  const start = istenen && istenen.startsWith("/") ? istenen : varsayilan;

  let initial;
  try {
    initial = { ...(await listDirectory(start)), roots };
  } catch {
    // İstenen yol açılamadıysa (izinsiz ya da yok) varsayılan köke düşülüyor;
    // boş bir hata ekranı göstermek kullanıcıyı çıkışsız bırakırdı.
    try {
      initial = { ...(await listDirectory(varsayilan)), roots };
    } catch {
      initial = {
        path: varsayilan,
        parent: null,
        entries: [],
        truncated: false,
        totalEntries: 0,
        roots,
      };
    }
  }

  return (
    <FilesScreen
      initial={initial}
      canWrite={hasPermission(session.user, "files.write")}
    />
  );
}
