import "server-only";
import { serverT } from "@/lib/i18n/runtime";

import { createHash } from "node:crypto";

import { panelImage } from "@/lib/host/self";
import { getDockerProvider } from "@/lib/providers";

/**
 * M3.8 — SSH yetkili anahtar denetimi.
 *
 * Soru basit ama cevabı çoğu zaman bilinmiyor: **bu sunucuya parolasız
 * girebilen kaç anahtar var ve bunlar kimin?** Yıllar içinde eklenen bir
 * dizüstünün anahtarı, silinmiş bir CI sisteminin deploy anahtarı ya da bir
 * kere denenip unutulan bir anahtar orada durur.
 *
 * Anahtarların KENDİSİ gösterilmiyor, parmak izleri gösteriliyor: açık anahtar
 * gizli bilgi değil ama ekranda taşımanın da bir faydası yok, parmak izi
 * karşılaştırma için yeterli.
 */

const SCRIPT = `
const fs = require("node:fs");
const path = require("node:path");

function readKeys(file, owner) {
  let text = "";
  try { text = fs.readFileSync(file, "utf8"); } catch { return []; }
  let mode = null;
  try { mode = (fs.statSync(file).mode & 0o777).toString(8); } catch {}

  return text.split("\\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"))
    .map((line) => {
      const parts = line.split(/\\s+/);
      // "ssh-ed25519 AAAA... yorum" ya da onundeki secenekler
      const typeIndex = parts.findIndex((p) => /^(ssh-|ecdsa-|sk-)/.test(p));
      if (typeIndex < 0) return null;
      return {
        owner,
        file,
        fileMode: mode,
        type: parts[typeIndex],
        key: parts[typeIndex + 1] || "",
        comment: parts.slice(typeIndex + 2).join(" "),
        options: typeIndex > 0 ? parts.slice(0, typeIndex).join(" ") : "",
      };
    })
    .filter(Boolean);
}

const out = [];
out.push(...readKeys("/host/root/root/.ssh/authorized_keys", "root"));

let homes = [];
try { homes = fs.readdirSync("/host/root/home"); } catch {}
for (const home of homes) {
  out.push(...readKeys(path.join("/host/root/home", home, ".ssh/authorized_keys"), home));
}

// sshd yapilandirmasindan iki kritik ayar
let config = "";
try { config = fs.readFileSync("/host/root/etc/ssh/sshd_config", "utf8"); } catch {}
let extra = "";
try {
  for (const f of fs.readdirSync("/host/root/etc/ssh/sshd_config.d")) {
    try { extra += "\\n" + fs.readFileSync("/host/root/etc/ssh/sshd_config.d/" + f, "utf8"); } catch {}
  }
} catch {}
const all = config + extra;
const setting = (name) => {
  const matches = [...all.matchAll(new RegExp("^\\\\s*" + name + "\\\\s+(\\\\S+)", "gim"))];
  return matches.length > 0 ? matches[matches.length - 1][1] : null;
};

console.log(JSON.stringify({
  ok: true,
  keys: out,
  sshd: {
    passwordAuthentication: setting("PasswordAuthentication"),
    permitRootLogin: setting("PermitRootLogin"),
    port: setting("Port"),
  },
}));
`;

export type SshKey = {
  owner: string;
  file: string;
  fileMode: string | null;
  type: string;
  fingerprint: string;
  comment: string;
  options: string;
  /** Anahtar bir komuta kısıtlanmış mı (command="…"). */
  restricted: boolean;
};

export type SshAudit = {
  keys: SshKey[];
  sshd: {
    passwordAuthentication: string | null;
    permitRootLogin: string | null;
    port: string | null;
  };
  /** Dikkat çekilmesi gereken noktalar — yargı değil gözlem. */
  notes: string[];
  error: string | null;
};

/** OpenSSH'ın gösterdiği biçim: SHA256:base64 (sondaki '=' atılır). */
function fingerprint(base64Key: string): string {
  try {
    const digest = createHash("sha256").update(Buffer.from(base64Key, "base64")).digest("base64");
    return `SHA256:${digest.replace(/=+$/, "")}`;
  } catch {
    return "SHA256:?";
  }
}

export async function auditSshKeys(): Promise<SshAudit> {
  const empty: SshAudit = {
    keys: [],
    sshd: { passwordAuthentication: null, permitRootLogin: null, port: null },
    notes: [],
    error: null,
  };

  const image = await panelImage();
  if (!image) return { ...empty, error: serverT("stacks.noPanelImage") };

  let output: string;
  try {
    const result = await getDockerProvider().runThrowaway({
      image,
      cmd: ["node", "-e", SCRIPT],
      binds: ["/:/host/root:ro"],
      env: {},
      namePrefix: "panel-sshaudit",
      timeoutMs: 60_000,
      user: "0:0",
    });
    if (result.exitCode !== 0) {
      return { ...empty, error: result.output.slice(0, 300) || serverT("sshLib.auditFailed") };
    }
    output = result.stdout ?? result.output;
  } catch (error) {
    return {
      ...empty,
      error: error instanceof Error ? error.message : serverT("sshLib.auditExec"),
    };
  }

  const line = output
    .split("\n")
    .map((entry) => entry.trim())
    .reverse()
    .find((entry) => entry.startsWith("{"));
  if (!line) return { ...empty, error: serverT("sshLib.parseFailed") };

  let parsed: {
    keys: {
      owner: string;
      file: string;
      fileMode: string | null;
      type: string;
      key: string;
      comment: string;
      options: string;
    }[];
    sshd: SshAudit["sshd"];
  };
  try {
    parsed = JSON.parse(line) as typeof parsed;
  } catch {
    return { ...empty, error: serverT("sshLib.notJson") };
  }

  const keys: SshKey[] = parsed.keys.map((entry) => ({
    owner: entry.owner,
    file: entry.file.replace("/host/root", ""),
    fileMode: entry.fileMode,
    type: entry.type,
    fingerprint: fingerprint(entry.key),
    comment: entry.comment,
    options: entry.options,
    restricted: entry.options.includes("command="),
  }));

  const notes: string[] = [];

  if (parsed.sshd.passwordAuthentication?.toLowerCase() === "yes") {
    notes.push(serverT("sshLib.passwordOn"));
  }
  if (parsed.sshd.permitRootLogin && !/^(no|prohibit-password)$/i.test(parsed.sshd.permitRootLogin)) {
    notes.push(serverT("sshLib.rootLogin", { value: parsed.sshd.permitRootLogin }));
  }
  const rootKeys = keys.filter((key) => key.owner === "root");
  if (rootKeys.length > 0) {
    notes.push(serverT("sshLib.rootKeys", { count: rootKeys.length }));
  }
  for (const key of keys) {
    if (key.fileMode && !["600", "400", "644"].includes(key.fileMode)) {
      notes.push(serverT("sshLib.fileMode", { file: key.file, mode: key.fileMode }));
      break;
    }
  }
  if (keys.length === 0) {
    notes.push(serverT("sshLib.noKeys"));
  }

  return { keys, sshd: parsed.sshd, notes, error: null };
}
