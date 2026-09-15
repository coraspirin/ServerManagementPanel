/**
 * Compose yığınlarının listelenmesi (M3.37).
 *
 * ## Neden iki kaynak birleşiyor
 *
 * Yığınları yalnızca container etiketlerinden keşfetmek yetmiyor:
 * **kurulumu BAŞARISIZ olan bir yığının container'ı yoktur.** Compose dosyası
 * diske yazılmış, `compose up` patlamış, geriye hiçbir container kalmamıştır —
 * yani etiket keşfinde hiç görünmez.
 *
 * Bu yaşanmış bir çıkmaz: passbolt olayında `compose up` "port is already
 * allocated" ile başarısız oldu ve kullanıcı panelde hiçbir iz göremedi.
 * `app_stacks` kaydı olmasa o yığını ne görebilir ne de "Tekrar dene"
 * diyebilirdi.
 *
 * Bu yüzden liste iki kaynağın birleşimi:
 *
 * | Kaynak | Nereden | Neyi yakalar |
 * |---|---|---|
 * | Keşfedilen | Container etiketleri | Panelin kurmadığı her yığın |
 * | Panelin kurduğu | `app_stacks` tablosu | Container'ı olmayan (başarısız ya da durdurulmuş) yığınlar |
 *
 * Ada göre birleşiyorlar; compose proje adı zaten benzersiz.
 *
 * I/O yok, `@/` yolu yok — `node --test` altında doğrudan çalışsın diye saf.
 */

/** Yığının panelce mi kurulduğu, yoksa dışarıda mı oluşturulduğu. */
export type StackSource = "panel" | "dis";

/** `buildStacks`'in container'dan ihtiyaç duyduğu alanlar — `ContainerView`'ın dar görünümü. */
export type StackContainer = {
  id: string;
  name: string;
  state: string;
  composeProject: string | null;
  composeService: string | null;
  cpuPct: number | null;
  memUsed: number | null;
  labels: Record<string, string> | null;
};

/** `app_stacks` satırının dar görünümü. */
export type StackRecord = {
  name: string;
  directory: string;
  lastAction: string;
  lastError: string;
};

export type StackRow = {
  name: string;
  source: StackSource;
  /** `compose up` çalıştırılacak dizin; yoksa compose işlemleri kapalı. */
  workingDir: string | null;
  /** Projenin bildirdiği compose dosyaları. */
  configFiles: string[];
  /** Yığının TÜM container'ları — süzgeçten bağımsız. */
  total: number;
  running: number;
  cpuPct: number | null;
  memUsed: number | null;
  /** Üyelerin id'leri; compose düzenleyici bunlardan birine ihtiyaç duyuyor. */
  containerIds: string[];
  /** Panel kaydından: son işlem ve hatası. Kayıt yoksa boş. */
  lastAction: string;
  lastError: string;
};

const PROJE = "com.docker.compose.project";
const CALISMA_DIZINI = "com.docker.compose.project.working_dir";
const DOSYALAR = "com.docker.compose.project.config_files";

/**
 * Yığın listesini üretir.
 *
 * @param containers Docker'daki TÜM container'lar (durmuşlar dahil). Süzülmüş
 *                   liste verilmemeli: "2/3 çalışıyor" sayısı arama kutusuna
 *                   göre değişirse yalan söyler.
 * @param records    `app_stacks` kayıtları.
 */
export function buildStacks(
  containers: StackContainer[],
  records: StackRecord[],
): StackRow[] {
  const byName = new Map<string, StackRow>();

  const bos = (name: string): StackRow => ({
    name,
    source: "dis",
    workingDir: null,
    configFiles: [],
    total: 0,
    running: 0,
    cpuPct: null,
    memUsed: null,
    containerIds: [],
    lastAction: "",
    lastError: "",
  });

  for (const container of containers) {
    const project = container.composeProject ?? "";
    if (!project) continue;

    let row = byName.get(project);
    if (!row) {
      row = bos(project);
      byName.set(project, row);
    }

    row.total += 1;
    if (container.state === "running") row.running += 1;
    row.containerIds.push(container.id);

    // Toplamlar: ölçümü olmayan container null bırakıyor, toplamı sıfırlamıyor.
    if (container.cpuPct !== null) row.cpuPct = (row.cpuPct ?? 0) + container.cpuPct;
    if (container.memUsed !== null) row.memUsed = (row.memUsed ?? 0) + container.memUsed;

    // Dizin ve dosya etiketleri proje geneline ait; ilk taşıyan üye yeterli.
    const labels = container.labels ?? {};
    if (!row.workingDir && labels[CALISMA_DIZINI]) row.workingDir = labels[CALISMA_DIZINI];
    if (row.configFiles.length === 0 && labels[DOSYALAR]) {
      row.configFiles = labels[DOSYALAR]
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean);
    }
  }

  for (const record of records) {
    let row = byName.get(record.name);
    if (!row) {
      // Container'ı olmayan kayıt: kurulum başarısız ya da yığın tamamen
      // durdurulmuş. Listede DURMASI şart — kullanıcının tek çıkış yolu.
      row = bos(record.name);
      byName.set(record.name, row);
    }

    row.source = "panel";
    row.lastAction = record.lastAction;
    row.lastError = record.lastError;
    // Etiket yoksa kaydın dizini kullanılıyor: durmuş bir yığında etiket
    // taşıyan container kalmamış olabilir.
    if (!row.workingDir && record.directory) row.workingDir = record.directory;
  }

  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name, "tr"));
}

/** Bir container'ın hangi yığına ait olduğu; yoksa boş dize. */
export function projectOf(container: StackContainer): string {
  return container.composeProject ?? container.labels?.[PROJE] ?? "";
}
