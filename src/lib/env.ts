/**
 * Dağıtım parametreleri (T9): bunlar ayar değil, env'de kalır.
 * Panelden değiştirilebilen her şey M0.5'teki ayar sistemine girer.
 */

/**
 * MOCK_MODE (T10): dış dünyaya dokunan her sağlayıcı sahte veri döndürür.
 * Windows'ta `npm run dev` ile sunucuya hiç gitmeden geliştirme yapmayı sağlar.
 */
export function isMockMode(): boolean {
  return process.env.MOCK_MODE === "1" || process.env.MOCK_MODE === "true";
}

export function appVersion(): string {
  return process.env.APP_VERSION ?? "1.9.0";
}
