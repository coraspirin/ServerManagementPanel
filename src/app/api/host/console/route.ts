import { guardApi } from "@/lib/auth/api";
import { audit } from "@/lib/auth/audit";
import { callHelper, helperConfigured, CONSOLE_TIMEOUT_MS } from "@/lib/host/helper";
import { findPreset } from "@/lib/host/presets";
import { getString } from "@/lib/settings";

export const dynamic = "force-dynamic";

/**
 * Sunucu konsolu — hazır kalıplar ve serbest komut.
 *
 * Buradaki iki mod, host tarafında iki AYRI eyleme karşılık gelir:
 *
 *   `shell.preset` — panel yalnızca bir anahtar gönderir; komut host'taki
 *   tabloda sabittir. Kullanıcı metni argv'ye hiç girmez.
 *
 *   `shell.exec` — komut metni host'ta bir kabuğa geçer. Projenin genel
 *   modelinden bilinçli bir sapma; bu yüzden izin listesinde ayrı satır ve
 *   varsayılan olarak kapalı. Kapalıyken burada bir şey yapılmaz, host
 *   reddeder ve sebebi kullanıcıya olduğu gibi gösterilir.
 *
 * Panel tarafındaki `host.shell` izni ve aşağıdaki yasaklı-parça kontrolü
 * güvenlik sınırı DEĞİL: ikisi de panelin içinde, yani panel ele geçirildiğinde
 * ikisi de gider. Sınır host'taki izin listesidir. Bunlar kazayı ve yetkisiz
 * kullanıcıya düğme göstermeyi engeller.
 */

/** Ayarlardan gelen "bu komut gönderilmez" listesi (boşsa sınır yok). */
function forbiddenConsoleCommand(command: string): string | null {
  const patterns = getString("console.forbidden")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry.length > 0);

  const lower = command.toLowerCase();
  for (const pattern of patterns) {
    if (lower.includes(pattern)) {
      return `Komut "${pattern}" içeriyor ve ayarlarda yasaklı (Ayarlar → Dosyalar → Sunucu konsolu).`;
    }
  }
  return null;
}

export async function POST(request: Request) {
  let body: { mode?: unknown; preset?: unknown; command?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: "geçersiz istek" }, { status: 400 });
  }

  const mode = String(body.mode ?? "");
  if (mode !== "preset" && mode !== "exec") {
    return Response.json({ error: "bilinmeyen mod" }, { status: 400 });
  }

  const guard = await guardApi(request, "host.shell");
  if (!guard.ok) return guard.response;

  if (!helperConfigured()) {
    return Response.json(
      {
        error:
          "host-helper kurulu değil. Sunucuda `sudo host-helper/install.sh` çalıştırıp HELPER_SECRET'i .env'e ekle.",
      },
      { status: 503 },
    );
  }

  // Ne çalıştığı, kim baktığında da anlaşılabilir olmalı: audit'e ve konsola
  // aynı metin yazılır.
  let args: Record<string, unknown>;
  let shown: string;

  if (mode === "preset") {
    const preset = findPreset(String(body.preset ?? ""));
    if (!preset) return Response.json({ error: "bilinmeyen kalıp" }, { status: 400 });
    args = { preset: preset.key };
    shown = preset.command;
  } else {
    const command = String(body.command ?? "").trim();
    if (command === "") return Response.json({ error: "komut boş" }, { status: 400 });
    if (command.length > 2000) {
      return Response.json({ error: "komut çok uzun (en fazla 2000 karakter)" }, { status: 400 });
    }
    if (/[\r\n\0]/.test(command)) {
      return Response.json({ error: "komut tek satır olmalı" }, { status: 400 });
    }

    const forbidden = forbiddenConsoleCommand(command);
    if (forbidden) {
      audit({
        userId: guard.session.user.id,
        username: guard.session.user.username,
        action: "host.console.exec",
        targetType: "host",
        targetId: command.slice(0, 120),
        detail: forbidden,
        result: "error",
      });
      return Response.json({ error: forbidden }, { status: 400 });
    }

    args = { command };
    shown = command;
  }

  const user = guard.session.user;
  const action = mode === "preset" ? "shell.preset" : "shell.exec";

  // Konsol komutları dakikalar sürebilir; helper'ın kendi sınırı 900 sn.
  const response = await callHelper(
    action,
    args,
    { username: user.username, userId: user.id },
    CONSOLE_TIMEOUT_MS,
  );

  audit({
    userId: user.id,
    username: user.username,
    action: mode === "preset" ? "host.console.preset" : "host.console.exec",
    targetType: "host",
    targetId: shown.slice(0, 120),
    detail: response.ok
      ? `çıkış ${response.exitCode ?? 0} · ${response.durationMs ?? 0} ms`
      : (response.error ?? response.stderr ?? "").slice(0, 200),
    result: response.ok ? "ok" : "error",
  });

  // Sıfırdan farklı çıkış kodu HATA DEĞİLDİR: `apt list --upgradable` ya da
  // `cat /var/run/reboot-required` normal işleyişte 1 döner. Helper `ok`
  // alanını çıkış koduna göre kurduğu için burada ikisi ayrıştırılıyor —
  // "komut çalışamadı" ile "komut çalıştı, sonucu bu" farklı şeyler.
  if (!response.ok && response.exitCode === undefined) {
    return Response.json(
      { error: response.error ?? "host-helper reddetti", command: shown },
      { status: 502 },
    );
  }

  return Response.json({
    ok: true,
    command: shown,
    exitCode: response.exitCode ?? 0,
    stdout: response.stdout ?? "",
    stderr: response.stderr ?? "",
    durationMs: response.durationMs ?? 0,
  });
}
