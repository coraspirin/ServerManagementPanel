#!/usr/bin/env node
/**
 * T12 — `docs/openapi.yaml` ile gerçek route ağacını karşılaştırır.
 *
 * NEDEN GEREKLİ: `redocly lint` şemanın kendi içinde geçerli olduğunu söyler,
 * DOĞRU olduğunu değil. Elle yazılan bir şema koddan sapabilir ve sapma
 * sessizdir — kimse fark etmeden bir uç şemada yaşamaya devam eder ya da yeni
 * bir uç belgesiz kalır. İkisi de bir sözleşme dosyasının en kötü hâli:
 * güvenilmez ama güvenilir görünen bir belge.
 *
 * Bu betik iki yönlü kontrol eder:
 *   - şemada olup kodda olmayan uç/metot  → istemci 404 alır
 *   - kodda olup şemada olmayan uç/metot  → belgelenmemiş yüzey
 *
 * YAML AYRIŞTIRICI YOK, bilerek: yeni bir bağımsızlık eklemek için fazla
 * küçük bir iş. Şema düzeni sabit (2 boşluk yol, 4 boşluk metot) ve düzen
 * bozulursa `redocly lint` zaten önce patlar.
 */

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const METHODS = ["GET", "POST", "PATCH", "PUT", "DELETE"];

/** Route ağacını gez: `[id]` → `{id}`, `route.ts` içindeki export'lar metotlar. */
function scanRoutes(dir, urlPrefix, out) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      scanRoutes(full, `${urlPrefix}/${entry.name.replace(/^\[(.+)\]$/, "{$1}")}`, out);
    } else if (entry.name === "route.ts") {
      const src = readFileSync(full, "utf8");
      out[urlPrefix] = METHODS.filter((m) =>
        new RegExp(`export async function ${m}\\b`).test(src),
      ).sort();
    }
  }
}

const code = {};
scanRoutes(path.join(ROOT, "src/app/api/v1"), "/api/v1", code);
scanRoutes(path.join(ROOT, "src/app/metrics"), "/metrics", code);

/** Şemadaki `paths:` bloğu. */
const lines = readFileSync(path.join(ROOT, "docs/openapi.yaml"), "utf8").split("\n");
const from = lines.indexOf("paths:");
const to = lines.findIndex((line, i) => i > from && line === "components:");
if (from === -1 || to === -1) {
  console.error("openapi.yaml içinde `paths:` ya da `components:` bulunamadı.");
  process.exit(1);
}

const spec = {};
let current = null;
for (let i = from + 1; i < to; i += 1) {
  const pathMatch = /^ {2}(\/[^:]*):\s*$/.exec(lines[i]);
  if (pathMatch) {
    current = pathMatch[1];
    spec[current] = [];
    continue;
  }
  const methodMatch = /^ {4}(get|post|patch|put|delete):\s*$/.exec(lines[i]);
  if (methodMatch && current) spec[current].push(methodMatch[1].toUpperCase());
}

const problems = [];
for (const url of [...new Set([...Object.keys(code), ...Object.keys(spec)])].sort()) {
  const inCode = (code[url] ?? []).sort().join(",");
  const inSpec = (spec[url] ?? []).sort().join(",");
  if (inCode !== inSpec) {
    problems.push(`  ${url}\n      kod:  [${inCode || "yok"}]\n      şema: [${inSpec || "yok"}]`);
  }
}

if (problems.length > 0) {
  console.error("docs/openapi.yaml kodla uyuşmuyor:\n");
  console.error(problems.join("\n"));
  console.error(
    "\nŞema `serialize.ts`in ikizidir — ikisi AYNI değişiklikte güncellenir.",
  );
  process.exit(1);
}

console.log(`openapi.yaml ${Object.keys(code).length} uçla birebir eşleşiyor.`);
