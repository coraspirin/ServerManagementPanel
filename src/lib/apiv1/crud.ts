import type { AppCard } from "@/lib/apps/types";
import type { Bookmark } from "@/lib/home/bookmarks";
import type { MaintenanceWindow, Monitor } from "@/lib/monitors/types";

/**
 * T12 / Faz D — v1 CRUD uçlarının PATCH anlamı.
 *
 * ⚠️ v1'in PATCH'i, panelin kendi `/api/{kaynak}/{id}` ucundan FARKLI davranır
 * ve bu bilinçli bir düzeltme.
 *
 * İç uçlar gövdeyi `parseX(body)`'ye olduğu gibi veriyor; o fonksiyonlar da
 * eksik alanlar için varsayılan üretiyor. Yani iç "PATCH" aslında bir PUT:
 * gönderilmeyen her alan varsayılana döner. Panelin formu her kaydetmede
 * BÜTÜN alanları gönderdiği için bu bugüne kadar sorun çıkarmadı.
 *
 * Bir API istemcisi öyle davranmaz. `{"enabled": false}` gönderen bir n8n
 * düğümü, monitörün `intervalSeconds` ezmesini ve `expected` kuralını sessizce
 * silerdi — istediği tek şey bir bayrağı kapatmakken. Veri kaybı, üstelik
 * hatasız bir `200` ile.
 *
 * Bu yüzden v1'de PATCH gerçek bir birleştirme: mevcut kaydın alanları taban
 * alınır, istemcinin GÖNDERDİĞİ anahtarlar üstüne yazılır, sonuç mevcut
 * `parseX` + `validateX` ikilisinden geçer. Doğrulama kopyalanmıyor —
 * birleştirilen gövde, POST'un geçtiği kapıdan geçiyor.
 *
 * Bu dosya YALNIZCA tip düzeyinde iç modellere bağlı (`import type`), böylece
 * `node:test` altında koşabiliyor: PATCH'in veri kaybettirmediği iddiası
 * kanıtlanabilir olmalı.
 */

/**
 * Mevcut gövdenin üstüne istemcinin gönderdiği anahtarları yazar.
 *
 * `undefined` DEĞERİ DE YAZILIR: JSON'da `undefined` yok, dolayısıyla bir
 * anahtarın gövdede bulunması istemcinin onu kastettiği anlamına gelir.
 * `{"expected": null}` göndermek "bu alanı boşalt" demek ve öyle davranmalı;
 * `undefined` ile atlamak arasındaki farkı korumak, JSON'da karşılığı olmayan
 * bir ayrım icat etmek olurdu.
 *
 * Tanınmayan anahtarlar zararsız biçimde taşınır — `parseX` onlara bakmıyor.
 * Bilinmeyen alanı reddetmek, "eklemeler serbest" sözüyle çelişirdi: bugün
 * anlamsız olan bir alan yarın gerçek olabilir ve o gün eski istemcilerin
 * gönderdiği fazlalık hata üretmemeli.
 */
export function mergePatch(
  current: Record<string, unknown>,
  incoming: Record<string, unknown>,
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...current };
  for (const key of Object.keys(incoming)) merged[key] = incoming[key];
  return merged;
}

/*
 * Aşağıdaki fonksiyonlar mevcut kaydı, ilgili `parseX`'in OKUDUĞU anahtar
 * adlarıyla düz bir gövdeye çeviriyor. Kaydın kendisini doğrudan yaymak
 * (`{...monitor}`) yanlış olurdu: `status`, `lastCheckAt`, `sortOrder` gibi
 * türetilmiş alanlar da gövdeye girerdi ve bir gün `parseX` onlardan birini
 * okumaya başlarsa istemcinin hiç göndermediği bir değer yazılırdı.
 */

export function monitorPatchBase(monitor: Monitor): Record<string, unknown> {
  return {
    name: monitor.name,
    type: monitor.type,
    target: monitor.target,
    expected: monitor.expected,
    enabled: monitor.enabled,
    ignoreTls: monitor.ignoreTls,
    intervalSeconds: monitor.intervalSeconds,
    timeoutSeconds: monitor.timeoutSeconds,
    retries: monitor.retries,
    downThreshold: monitor.downThreshold,
  };
}

/**
 * `icon`, `color`, `internalUrl` tabana KONUYOR ama v1 şeklinde dönmüyor.
 *
 * Çelişki değil, tam tersi: istemci bu alanları göremediği için gönderemez de.
 * Tabana konmasalardı, dış bir istemcinin yaptığı her PATCH panelden yüklenmiş
 * logoyu ve rengi sıfırlardı — kullanıcı v1 ile bir kartın adını
 * değiştirdiğinde logosunun kaybolduğunu görürdü.
 */
export function appPatchBase(card: AppCard): Record<string, unknown> {
  return {
    categoryId: card.categoryId,
    name: card.name,
    description: card.description,
    url: card.url,
    internalUrl: card.internalUrl,
    icon: card.icon,
    color: card.color,
    monitorId: card.monitorId,
    containerName: card.containerName,
    openNewTab: card.openNewTab,
    enabled: card.enabled,
    showOnLogin: card.showOnLogin,
  };
}

export function bookmarkPatchBase(bookmark: Bookmark): Record<string, unknown> {
  return {
    group: bookmark.group,
    title: bookmark.title,
    url: bookmark.url,
  };
}

export function maintenancePatchBase(window: MaintenanceWindow): Record<string, unknown> {
  return {
    name: window.name,
    kind: window.kind,
    startsAt: window.startsAt,
    endsAt: window.endsAt,
    weekdays: window.weekdays,
    startMinute: window.startMinute,
    endMinute: window.endMinute,
    monitorId: window.monitorId,
    enabled: window.enabled,
  };
}

/**
 * Yol parametresindeki sayısal kimlik.
 *
 * `Number("abc")` → `NaN` ve `NaN` bir sorguya girdiğinde sessizce "kayıt yok"
 * üretir; istemci `404` alır ve kimliğinin BOZUK olduğunu değil, kaydın
 * silindiğini sanır. Ayrım korunuyor: bozuk kimlik `400`, geçerli ama var
 * olmayan kimlik `404`.
 */
export function parseId(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}
