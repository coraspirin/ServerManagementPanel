import { readFile } from "node:fs/promises";
import path from "node:path";

/**
 * MOCK_MODE sağlayıcılarının okuduğu sabit veri kümeleri (T10).
 * Dosyalar repo kökündeki `fixtures/` altında durur ve imaja da kopyalanır,
 * böylece sunucuda da MOCK_MODE ile açılıp sorun ayıklanabilir.
 */
export async function loadFixture<T>(name: string): Promise<T> {
  const file = path.join(process.cwd(), "fixtures", `${name}.json`);
  return JSON.parse(await readFile(file, "utf8")) as T;
}
