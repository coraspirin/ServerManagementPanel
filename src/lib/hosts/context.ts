import { AsyncLocalStorage } from "node:async_hooks";
import { HostError } from "./errors.ts";

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
 * Bağlam yokken kullanılacak sunucuyu bulan fonksiyon. Merkezde açılışta
 * (`instrumentation.ts`) kaydedilir: yerel etkinse yerel, değilse ilk etkin
 * sunucu, hiç yoksa null. Kayıt yoksa (ajan süreci, birim testleri) yerel.
 *
 * `globalThis`'te tutulur: Next bu modülü route paketleri ile
 * instrumentation arasında çoğaltabilir, modül değişkeni paylaşılmayabilir.
 */
type DefaultHostResolver = () => number | null;
const RESOLVER_KEY = Symbol.for("panel.defaultHostResolver");
type ResolverHolder = { [RESOLVER_KEY]?: DefaultHostResolver };

export function setDefaultHostResolver(resolver: DefaultHostResolver | null): void {
  const holder = globalThis as ResolverHolder;
  if (resolver) holder[RESOLVER_KEY] = resolver;
  else delete holder[RESOLVER_KEY];
}

/**
 * Etkin sunucu. Bağlam açılmamışsa varsayılan sunucu (yukarıdaki çözücü);
 * hiç etkin sunucu yoksa `HostError("noHost")` — yerele sessizce düşülmez
 * (yerel sunucu devre dışı olabilir, bkz. kararlar.md D1).
 */
export function currentHostId(): number {
  const store = storage.getStore();
  if (store) return store.hostId;
  const resolver = (globalThis as ResolverHolder)[RESOLVER_KEY];
  if (!resolver) return LOCAL_HOST_ID;
  const id = resolver();
  if (id === null) throw new HostError("noHost", 0);
  return id;
}

/** `currentHostId` gibi ama etkin sunucu yoksa fırlatmak yerine null. */
export function currentHostIdOrNull(): number | null {
  const store = storage.getStore();
  if (store) return store.hostId;
  const resolver = (globalThis as ResolverHolder)[RESOLVER_KEY];
  return resolver ? resolver() : LOCAL_HOST_ID;
}

/**
 * Yalnızca AÇIKÇA kurulmuş bağlamın sunucusu; bağlam yoksa null. Varsayılan
 * sunucu tahmini yapılmaz — örn. denetim kaydı: girişi/kullanıcı işlemini
 * rastgele bir ajana yazmak yanlış olur.
 */
export function contextHostId(): number | null {
  return storage.getStore()?.hostId ?? null;
}

/** Bağlam açıkça kurulmuş mu? Teşhis ve testler için. */
export function hasHostContext(): boolean {
  return storage.getStore() !== undefined;
}
