/**
 * Sunucu açılışında bir kez çalışır (dev ve production).
 *
 * Sıra önemli: önce şema, sonra ilk yönetici hesabı. Migration başarısız
 * olursa hata fırlatılır ve uygulama açılmaz — bozuk şemayla çalışmaktansa
 * açılmamak yeğdir (T11).
 *
 * Not: M0.6'da ayrı worker process gelince açılış sorumluluğu tek bir yere
 * taşınacak; iki process'in aynı anda migration denemesi yarış yaratır.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { masterKeyAvailable } = await import("@/lib/crypto");
  if (!masterKeyAvailable()) {
    const { randomBytes } = await import("node:crypto");
    const suggestion = randomBytes(32).toString("hex");
    throw new Error(
      "MASTER_KEY tanımlı değil (T3 — secret şifreleme anahtarı).\n" + // i18n-ignore — operatör logu
        `.env dosyasına ekle:\n\n  MASTER_KEY=${suggestion}\n\n` + // i18n-ignore — operatör logu
        "Bu anahtarı panel dışında AYRI bir yerde de sakla; yedeğe girmez.", // i18n-ignore — operatör logu
    );
  }

  const { runMigrations } = await import("@/lib/db/migrate");
  const result = runMigrations();

  if (result.applied.length > 0) {
    if (result.backupPath) {
      console.log(`[db] migration öncesi yedek: ${result.backupPath}`);
    }
    console.log(
      `[db] şema ${result.from} → ${result.to} (uygulanan: ${result.applied.join(", ")})`, // i18n-ignore — operatör logu
    );
  } else {
    console.log(`[db] şema güncel (v${result.to})`);
  }

  // T9 — env tohumlaması migration'lardan SONRA, admin'den ÖNCE:
  // bootstrap ayarlardan okuyabilsin.
  const { seedFromEnv } = await import("@/lib/settings");
  const seeded = seedFromEnv();
  if (seeded.length > 0) {
    console.log(`[settings] env'den tohumlandı: ${seeded.join(", ")}`);
  }

  // Arayüz dili — tohumlamadan SONRA: dil env'den gelmiş olabilir.
  // Kütüphane kodu ve API uçları seçili dili yalnızca bu kayıt sayesinde
  // görebiliyor; yapılmazsa hepsi Türkçeye düşer (bkz. lib/i18n/runtime.ts).
  const { registerLocaleResolver } = await import("@/lib/i18n/server");
  registerLocaleResolver();

  const { bootstrapAdmin } = await import("@/lib/auth/bootstrap");
  bootstrapAdmin();

  const { pruneExpiredSessions } = await import("@/lib/auth/session");
  const pruned = pruneExpiredSessions();
  if (pruned > 0) console.log(`[auth] ${pruned} süresi dolmuş oturum temizlendi`);

  // T10 — yalnızca MOCK_MODE'da: uzun dönem grafikleri ve katman seçimi
  // haftalarca veri beklemeden sınanabilsin diye geçmiş üretilir.
  // Çoklu sunucu: MOCK_HOSTS ile sahte sunucular (geçmişten ÖNCE — geçmiş
  // onlar için de üretilsin).
  const { seedMockHosts } = await import("@/lib/hosts/mock");
  const seededHosts = seedMockHosts();
  if (seededHosts) console.log(`[hosts] ${seededHosts}`);

  const { seedMockHistory } = await import("@/lib/metrics/mock-history");
  const seededHistory = await seedMockHistory();
  if (seededHistory) console.log(`[metrics] ${seededHistory}`);

  // T2 — arka plan işleri. Zamanlamalar ayarlardan okunur.
  const { startScheduler } = await import("@/lib/jobs/runner");
  startScheduler();

  /*
    M3.32 — Docker olay akışı. Zamanlanmış bir iş DEĞİL, uzun ömürlü bir
    abonelik: Docker olayları oluştukça yazıyor ve periyodik yoklama hem
    gecikme hem de iki tur arasında olay kaçırma riski demek olurdu.

    Bağlantı kurulamazsa yalnızca günlüğe yazıyor; panel açılmaya devam
    ediyor. Olay akışı panelin çalışma koşulu değil.
  */
  const { startDockerEvents } = await import("@/lib/docker/events");
  startDockerEvents();
}
