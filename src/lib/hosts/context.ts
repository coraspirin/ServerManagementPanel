import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Çoklu sunucu — "şu an hangi sunucu için çalışıyoruz?" bilgisi.
 *
 * Sunucu kimliği fonksiyon parametresi olarak taşınmıyor: yüzlerce imzayı
 * değiştirmek yerine istek (ya da job) girişinde `runWithHost` ile bağlam
 * açılır, alttaki darboğazlar (provider seçimi, helper, host dosya sistemi,
 * ayarlar) `currentHostId()` ile okur. AsyncLocalStorage `await` ve
 * `Promise.all` boyunca bağlamı korur; paralel çalışan iki sunucu birbirinin
 * bağlamını görmez.
 *
 * Bu modül bilerek saf: `server-only` ve `@/` alias'ı yok, testler doğrudan
 * import edebilsin.
 */

/** Panelin üzerinde çalıştığı sunucu. 001 migration'ı bu satırı seed eder. */
export const LOCAL_HOST_ID = 1;

type HostStore = {
  hostId: number;
  /**
   * Ajan tarafında: merkezin bu istek için çözüp gönderdiği sunucuya özgü
   * ayar değerleri (`SettingDef.hostScoped`). Ajanın kendi veritabanı boş;
   * ayarların tek doğru kaynağı merkez.
   */
  settings?: Record<string, unknown>;
};

const storage = new AsyncLocalStorage<HostStore>();

export function runWithHost<T>(
  hostId: number,
  fn: () => T,
  extras?: { settings?: Record<string, unknown> },
): T {
  return storage.run({ hostId, settings: extras?.settings }, fn);
}

/**
 * Geçerli async akışın geri kalanını bu sunucunun bağlamına sokar.
 *
 * Route handler'da yetki kontrolünden HEMEN SONRA çağrılır; handler'ın
 * kalanı ve başlattığı tüm async işler bu bağlamı görür, çağıran (Next) ve
 * paralel istekler görmez. Gövdeyi `runWithHost` ile sarmaktan farkı yalnızca
 * sözdizimi: elli route dosyasının gövdesini yeniden girintilemek yerine tek
 * satır. Yalnızca bir `await`ten SONRA çağrılmalı — senkron çağrıda bağlam
 * çağıranın akışına da sızar.
 */
export function enterHost(hostId: number): void {
  storage.enterWith({ hostId });
}

export function hostSettingsOverlay(): Record<string, unknown> | undefined {
  return storage.getStore()?.settings;
}

/**
 * Etkin sunucu. Bağlam açılmamışsa yerel sunucu — tek sunuculu kurulumda ve
 * henüz sarmalanmamış kod yollarında davranış eskisiyle aynı kalır.
 */
export function currentHostId(): number {
  return storage.getStore()?.hostId ?? LOCAL_HOST_ID;
}

/** Bağlam açıkça kurulmuş mu? Teşhis ve testler için. */
export function hasHostContext(): boolean {
  return storage.getStore() !== undefined;
}
