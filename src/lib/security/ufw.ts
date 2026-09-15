/**
 * ufw çıktısının ayrıştırılması ve bir değişikliğin tehlikeli olup olmadığı.
 *
 * Bu dosyada I/O YOK — `firewall.ts` helper'ı çağırır, buradaki saf
 * fonksiyonlar gelen metni yorumlar. Ayrılmasının sebebi test edilebilirlik:
 * `dangerousChange`'in yanlış bir "sorun yok" cevabı, kullanıcının sunucusuna
 * erişimini kaybetmesi demek ve bu, helper'a hiç dokunmadan doğrulanabilmeli.
 */

export type FirewallRule = {
  number: number;
  raw: string;
  to: string;
  action: string;
  from: string;
  comment: string;
};

export type FirewallDefaults = {
  incoming: string;
  outgoing: string;
  routed: string;
};

export type FirewallState = {
  available: boolean;
  active: boolean;
  rules: FirewallRule[];
  /**
   * `ufw status verbose` okunabildiyse varsayılan politikalar.
   *
   * null = okunamadı (izin listesinde `ufw.status_verbose` yok). Bilinmeyeni
   * "deny" diye varsaymak, gelen trafiğe açık bir sunucuyu korunuyor gibi
   * göstermek olurdu.
   */
  defaults: FirewallDefaults | null;
  logging: string | null;
  /** Kullanıcıya gösterilecek durum/uyarı metni. */
  message: string;
  /** İzin listesi eksikse kurulum talimatı. */
  setupHint: string | null;
};

/**
 * `ufw status numbered` çıktısı:
 *   Status: active
 *
 *   To                         Action      From
 *   --                         ------      ----
 *   [ 1] 22/tcp                ALLOW IN    Anywhere                   # SSH
 */
export function parseUfwStatus(stdout: string): { active: boolean; rules: FirewallRule[] } {
  const active = /^Status:\s*active/im.test(stdout);
  const rules: FirewallRule[] = [];

  for (const line of stdout.split("\n")) {
    const match = line.match(/^\[\s*(\d+)\]\s+(.+)$/);
    if (!match) continue;

    const number = Number(match[1]);
    let rest = match[2].trimEnd();

    // Açıklama ÖNCE ayrılıyor: sütun bölmesi iki boşluğa bakıyor ve "# panel
    // yonetimi" dördüncü bir sütun gibi görünürdü.
    let comment = "";
    const commented = rest.match(/^(.*?)\s+#\s*(.*)$/);
    if (commented) {
      rest = commented[1].trimEnd();
      comment = commented[2].trim();
    }

    // Sütunlar iki ya da daha fazla boşlukla ayrılıyor; tek boşluk "ALLOW IN"
    // gibi değerlerin içinde geçiyor.
    const columns = rest.split(/\s{2,}/).map((entry) => entry.trim()).filter(Boolean);

    rules.push({
      number,
      raw: match[2].trimEnd(),
      to: columns[0] ?? "",
      action: columns[1] ?? "",
      from: columns[2] ?? "",
      comment,
    });
  }

  return { active, rules };
}

/**
 * `ufw status verbose` çıktısı:
 *   Status: active
 *   Logging: on (low)
 *   Default: deny (incoming), allow (outgoing), disabled (routed)
 */
export function parseUfwVerbose(stdout: string): {
  defaults: FirewallDefaults | null;
  logging: string | null;
} {
  const defaults = stdout.match(
    /^Default:\s*(\w+)\s*\(incoming\),\s*(\w+)\s*\(outgoing\),\s*(\w+)\s*\(routed\)/im,
  );
  const logging = stdout.match(/^Logging:\s*(.+)$/im);

  return {
    defaults: defaults
      ? { incoming: defaults[1], outgoing: defaults[2], routed: defaults[3] }
      : null,
    logging: logging ? logging[1].trim() : null,
  };
}

/**
 * Caddy'nin host'ta dinlediği portlar — compose bunları env'den okuyor,
 * sabit 80/443 değil.
 *
 * İKİSİ de listede: panelin kendisi HTTP portunda (M3.45), panelden
 * yayınlanan TLS'li siteler HTTPS portunda sunuluyor. Yalnızca birini
 * güvenlik duvarında açmak, diğerini sessizce erişilemez yapardı.
 */
export function panelPorts(): number[] {
  const https = Number(process.env.PANEL_HTTPS_PORT ?? 8443);
  const http = Number(process.env.PANEL_HTTP_PORT ?? 8080);
  return [https, http].filter((port) => Number.isFinite(port) && port > 0);
}

function panelSubnet(): string {
  return process.env.PANEL_SUBNET ?? "172.28.0.0/16";
}

/**
 * Bir kural, bu porta gelen trafiğe İZİN veriyor mu?
 *
 * `to` sütununa bakıyor: "22/tcp", "8443", ya da uygulama profili ("OpenSSH").
 * Profil adları için port eşlemesi panelde yok — 22'de SSH profillerini adıyla
 * tanımak, "kuralın var ama göremedim" diye yanlış alarm vermekten iyi.
 */
function allowsPort(rules: FirewallRule[], port: number): boolean {
  return rules.some((rule) => {
    if (!/^ALLOW/i.test(rule.action)) return false;
    if (new RegExp(`(^|[^0-9])${port}([^0-9]|$)`).test(rule.to)) return true;
    return port === 22 && /ssh/i.test(rule.to);
  });
}

export type FirewallChange =
  | { kind: "rule"; rule: string; action: "allow" | "deny" }
  | { kind: "enable" }
  | { kind: "default"; policy: string; direction: string };

/**
 * Bu değişiklik sunucuya erişimi kesebilir mi?
 *
 * Dönen metin null değilse ekran ONAY İSTER. Engellemiyoruz — kullanıcı ne
 * yaptığını biliyor olabilir; ama neyin kesileceğini ADIYLA söylemeden
 * yapmasına izin vermiyoruz.
 *
 * `enable` bu listenin en tehlikelisi: kural listesi boş bir sunucuda
 * `ufw --force enable`, SSH dahil her şeyi keser ve sunucuya fiziksel erişim
 * dışında dönüş yolu bırakmaz.
 */
export function dangerousChange(change: FirewallChange, state: FirewallState): string | null {
  if (change.kind === "rule") {
    if (change.action !== "deny") return null;

    const port = Number(
      change.rule.match(/^(\d{1,5})/)?.[1] ?? change.rule.match(/port (\d{1,5})/)?.[1] ?? 0,
    );
    if (panelPorts().includes(port)) {
      return `Bu kural panelin kendi portunu (${port}) kapatabilir.`;
    }
    if (port === 443 || port === 80) {
      return "Bu kural panelin kendisine erişimi kesebilir.";
    }
    if (port === 22) {
      return "Bu kural SSH erişimini kesebilir — panel bozulursa sunucuya giremezsin.";
    }
    return null;
  }

  if (change.kind === "enable") {
    const missing: string[] = [];
    if (!allowsPort(state.rules, 22)) missing.push("SSH (22)");
    for (const port of panelPorts()) {
      if (!allowsPort(state.rules, port)) missing.push(`panel portu (${port})`);
    }

    if (missing.length > 0) {
      return (
        `Güvenlik duvarı açılırsa şunlara erişim kesilebilir: ${missing.join(", ")} — ` +
        "kural listesinde bunlara izin veren bir satır yok. Önce kuralları ekle, sonra etkinleştir."
      );
    }

    const subnet = panelSubnet();
    if (!state.rules.some((rule) => rule.from.includes(subnet))) {
      return (
        `Kural listesinde Docker alt ağından (${subnet}) gelen trafiğe izin veren bir satır ` +
        "görünmüyor. SSH ve panel portu açık olduğu için erişimini kaybetmemelisin, ama " +
        "container'lar arası bazı akışlar etkilenebilir."
      );
    }

    return null;
  }

  if (change.direction === "incoming" && change.policy === "allow") {
    return (
      "Gelen trafiğin varsayılanını 'allow' yapmak, kural yazılmamış HER portu dışarı açar — " +
      "güvenlik duvarı bu hâlde neredeyse hiçbir şey korumaz."
    );
  }
  if (change.direction === "outgoing" && change.policy !== "allow") {
    return (
      "Giden trafiği kısıtlamak sunucunun kendi güncellemelerini, DNS'ini ve panelin dış " +
      "çağrılarını kesebilir."
    );
  }

  return null;
}
