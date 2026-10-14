#!/usr/bin/env node
/**
 * Native (Go) ajanın kullanıcıya dönen metinleri — panelin dil dosyalarından
 * ÇIKARILIR, elle yazılmaz: tek kaynak `src/locales/*.json`.
 *
 * Ajan, isteğe merkezin eklediği `settings["general.language"]` diline göre
 * bu metinleri seçer (Node ajandaki `serverT` ile aynı sonuç). Yalnız
 * aşağıdaki önekler taşınır; ajana yeni metin gerekirse önek buraya eklenir.
 *
 * Kullanım: node scripts/agent-strings.mjs        → dosyayı yazar
 *           node scripts/agent-strings.mjs --check → güncel değilse 1 döner
 */
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PREFIXES = [
  "hardwareLib.",
  "execLib.",
  "dockerUpdate.notFound",
  "api.notFound.session",
  "api.invalidRequest",
  "paths.",
  "browse.",
  "fileWrite.",
  "docker.installer.ok",
  "dirs.",
  "hostUsers.",
  "backupWatch.",
  "cleanup.",
  "hosts.errors.unsupported",
];

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const localesDir = path.join(root, "src", "locales");
const target = path.join(root, "agent", "internal", "i18n", "strings.json");

const out = {};
for (const file of readdirSync(localesDir).filter((name) => /^[a-z]{2}\.json$/.test(name)).sort()) {
  const dict = JSON.parse(readFileSync(path.join(localesDir, file), "utf8"));
  const picked = {};
  for (const key of Object.keys(dict).sort()) {
    if (PREFIXES.some((prefix) => key.startsWith(prefix))) picked[key] = dict[key];
  }
  out[file.slice(0, 2)] = picked;
}

const text = `${JSON.stringify(out, null, 2)}\n`;
if (process.argv.includes("--check")) {
  let current = "";
  try {
    current = readFileSync(target, "utf8");
  } catch {
    // yok
  }
  if (current !== text) {
    console.error("agent/internal/i18n/strings.json güncel değil — node scripts/agent-strings.mjs"); // i18n-ignore — geliştirici çıktısı
    process.exit(1);
  }
  console.log("✔ ajan metinleri güncel"); // i18n-ignore — geliştirici çıktısı
} else {
  writeFileSync(target, text);
  console.log(`ajan metinleri yazıldı: ${Object.keys(out).join(", ")}`); // i18n-ignore — geliştirici çıktısı
}
