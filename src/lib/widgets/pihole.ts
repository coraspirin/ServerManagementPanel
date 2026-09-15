import "server-only";

import type { WidgetContext, WidgetData, WidgetProvider } from "./types";

/**
 * M2.6 — Pi-hole v6 widget'ı.
 *
 * v5 ile v6'nın API'leri tamamen farklı: v5 `/admin/api.php?auth=<token>`
 * kullanıyordu, v6 oturum açtırıp SID veriyor. Burada YALNIZCA v6 destekleniyor
 * (sunucudaki sürüm v6.4.2) — v5'i de desteklemeye çalışmak, sınayamadığımız
 * bir kod yolu eklemek olurdu.
 *
 * ⚠️ Oturum sayısı SINIRLI: Pi-hole eşzamanlı oturumları sayar ve dolduğunda
 *    yeni girişleri reddeder. Panel her yenilemede giriş yapsaydı birkaç
 *    dakika içinde Pi-hole'un oturum havuzunu tüketir ve kullanıcı kendi
 *    arayüzüne giremezdi. Bu yüzden SID bellekte tutulup yeniden kullanılıyor.
 */

const TIMEOUT_MS = 8_000;

/** Kapatma süresi: PLAN'daki "5 dk devre dışı bırak". */
const DISABLE_SECONDS = 300;

type Session = { sid: string; csrf: string; expiresAt: number };

// Anahtar = baseUrl: aynı panelde birden çok Pi-hole kartı olabilir.
const sessions = new Map<string, Session>();

type AuthPayload = {
  session?: { valid?: boolean; sid?: string | null; csrf?: string | null; validity?: number; message?: string | null };
  error?: { message?: string };
};

async function login(context: WidgetContext): Promise<Session> {
  const password = context.config.password ?? "";
  if (!password.trim()) throw new Error("Pi-hole parolası girilmemiş.");

  const response = await fetch(`${context.baseUrl}/api/auth`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ password }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  const payload = (await response.json().catch(() => ({}))) as AuthPayload;

  if (!response.ok || !payload.session?.valid || !payload.session.sid) {
    const reason = payload.session?.message ?? payload.error?.message ?? `HTTP ${response.status}`;
    // En sık iki sebep ayırt ediliyor: yanlış parola mı, oturum havuzu dolu mu.
    // "Unauthorized" demek kullanıcıyı parolayı defalarca kontrol etmeye iter.
    throw new Error(
      /seat|session/i.test(String(reason))
        ? `Pi-hole oturum havuzu dolu (${reason}). Pi-hole arayüzünden açık oturumları kapatabilirsin.`
        : `Pi-hole girişi reddedildi: ${reason}`,
    );
  }

  // Ömrün tamamı kullanılmıyor: sona bir dakika kala yenilemek, tam sınırda
  // patlayan bir isteğin kullanıcıya hata olarak dönmesini engelliyor.
  const validity = payload.session.validity ?? 300;
  return {
    sid: payload.session.sid,
    csrf: payload.session.csrf ?? "",
    expiresAt: Date.now() + Math.max(30, validity - 60) * 1000,
  };
}

async function session(context: WidgetContext, force = false): Promise<Session> {
  const cached = sessions.get(context.baseUrl);
  if (!force && cached && cached.expiresAt > Date.now()) return cached;

  const fresh = await login(context);
  sessions.set(context.baseUrl, fresh);
  return fresh;
}

/**
 * Kimlikli istek. 401 alınca oturum bir kez yenilenip TEK sefer denenir.
 *
 * Tek sefer: Pi-hole yeniden başlatıldığında elimizdeki SID ölür ve bunu
 * ancak 401'den anlarız. Sınırsız denemek ise yanlış parolada sonsuz giriş
 * denemesi demek olurdu.
 */
async function call(
  context: WidgetContext,
  path: string,
  init?: { method: string; body: unknown },
): Promise<unknown> {
  const attempt = async (retrying: boolean): Promise<Response> => {
    const active = await session(context, retrying);
    return fetch(`${context.baseUrl}${path}`, {
      method: init?.method ?? "GET",
      headers: {
        "X-FTL-SID": active.sid,
        ...(active.csrf ? { "X-FTL-CSRF": active.csrf } : {}),
        ...(init ? { "content-type": "application/json" } : {}),
      },
      body: init ? JSON.stringify(init.body) : undefined,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  };

  let response = await attempt(false);
  if (response.status === 401) {
    sessions.delete(context.baseUrl);
    response = await attempt(true);
  }

  if (!response.ok) {
    throw new Error(`Pi-hole ${path} → HTTP ${response.status}`);
  }
  return response.json();
}

type SummaryPayload = {
  queries?: {
    total?: number;
    blocked?: number;
    percent_blocked?: number;
    unique_domains?: number;
  };
  gravity?: { domains_being_blocked?: number };
};

type TopDomainsPayload = { domains?: { domain?: string; count?: number }[] };
type BlockingPayload = { blocking?: string; timer?: number | null };

function formatCount(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 10_000) return `${Math.round(value / 1000)}B`;
  if (value >= 1000) return `${(value / 1000).toFixed(1)}B`;
  return String(value);
}

export const piholeWidget: WidgetProvider = {
  def: {
    key: "pihole",
    label: "Pi-hole",
    help: "Pi-hole v6 gerekiyor. Parola olarak web arayüzü parolasını ya da Pi-hole'da ürettiğin bir uygulama parolasını gir.",
    fields: [
      {
        key: "password",
        label: "Pi-hole parolası",
        type: "secret",
        required: true,
        help: "Şifrelenerek saklanır (T3). Uygulama parolası kullanmak yeğdir: iptal edildiğinde web girişin etkilenmez.",
      },
    ],
    actions: [
      {
        key: "disable",
        label: "5 dk devre dışı bırak",
        confirm: "Pi-hole engellemesi 5 dakika kapatılsın mı? Bu süre boyunca reklam ve izleyici alan adları engellenmez.",
      },
      { key: "enable", label: "Engellemeyi aç" },
    ],
  },

  async load(context): Promise<WidgetData> {
    // Üç istek paralel: sıraya dizmek widget'ı üç katı yavaşlatırdı ve
    // hepsi aynı oturumu kullandığı için ek maliyet yok.
    const [summary, top, blocking] = (await Promise.all([
      call(context, "/api/stats/summary"),
      call(context, "/api/stats/top_domains?blocked=true&count=1"),
      call(context, "/api/dns/blocking"),
    ])) as [SummaryPayload, TopDomainsPayload, BlockingPayload];

    const total = summary.queries?.total ?? 0;
    const blocked = summary.queries?.blocked ?? 0;
    const percent = summary.queries?.percent_blocked ?? (total > 0 ? (blocked / total) * 100 : 0);
    const enabled = blocking.blocking !== "disabled";
    const topDomain = top.domains?.[0];

    return {
      stats: [
        { label: "Sorgu (24 sa)", value: formatCount(total) },
        {
          label: "Engellendi",
          value: formatCount(blocked),
          // Engelleme kapalıyken sayılar hâlâ dünkü veriyi gösterir; rengi
          // nötr bırakmak "her şey yolunda" izlenimi vermesini önlüyor.
          tone: enabled ? "ok" : "neutral",
        },
        { label: "Oran", value: `%${percent.toFixed(1)}`, tone: enabled ? "ok" : "neutral" },
      ],
      lines: [
        ...(topDomain?.domain
          ? [{ label: "En çok engellenen", value: `${topDomain.domain} (${topDomain.count ?? 0})` }]
          : []),
        {
          label: "Engel listesi",
          value: `${formatCount(summary.gravity?.domains_being_blocked ?? 0)} alan adı`,
        },
      ],
      note: enabled
        ? null
        : blocking.timer
          ? `Engelleme kapalı — ${Math.ceil(blocking.timer / 60)} dk sonra kendiliğinden açılacak.`
          : "Engelleme SÜRESİZ kapalı.",
      availableActions: enabled ? ["disable"] : ["enable"],
    };
  },

  async act(action, context): Promise<string> {
    if (action === "disable") {
      await call(context, "/api/dns/blocking", {
        method: "POST",
        body: { blocking: false, timer: DISABLE_SECONDS },
      });
      return `Pi-hole engellemesi ${DISABLE_SECONDS / 60} dakika kapatıldı.`;
    }

    if (action === "enable") {
      // `timer: null` şart: süre verilmezse Pi-hole son zamanlayıcıyı
      // koruyabiliyor ve "açtım ama yine kapandı" durumu doğuyor.
      await call(context, "/api/dns/blocking", {
        method: "POST",
        body: { blocking: true, timer: null },
      });
      return "Pi-hole engellemesi açıldı.";
    }

    throw new Error(`Bilinmeyen aksiyon: ${action}`);
  },
};
