# Güvenlik — /security
Son güncelleme: 2026-10-13 · fail2ban yönergesi (commit edilmedi)

## Ne yapar
Güvenlik monitörleri: SSH yetkili anahtar denetimi, fail2ban ban listesi + başarısız girişler (ban kaldırma), UPnP port yönlendirme envanteri, Docker imaj CVE taraması (Trivy). Port haritasına bağlantı verir (güvenlik duvarı ekranı 2026-10-11'de kaldırıldı).

## Dosyalar
- Sayfa: `src/app/(panel)/security/page.tsx` — `requirePermission("security.view")`, `pageHostId({ agent: true })`.
- Ekran: `SecurityScreen.tsx` (115); asıl içerik `src/components/security/SecurityMonitors.tsx` (558).
- API:
  - `src/app/api/security/monitor/route.ts` GET — `security.view`; `mode=ssh` ise `{ agent: true }`, diğerleri `{ localOnly: true }`; POST `security.manage` (localOnly)
  - `src/app/api/security/route.ts` GET — `security.view`, localOnly
- lib: `src/lib/security/sshkeys.ts`, `fail2ban.ts` (helper), `upnp.ts` (IGD sorgusu), `vuln.ts` (Trivy geçici container; DB `panel-trivy-cache` volume'ünde).
- Tablolar: `port_forwards`, `vuln_scans` (`017_security.ts`).
- Locale: `secmon.*`, `securityScreen.*`.

## Yetki yönergesi (D6, 2026-10-13)
- `fail2ban.ts` `Fail2banState.hint`: helper yok → `helperMissing`; eylem kapalı → `helperUnverified` (3 fail2ban satırı); eski helper → `helperOutdated`. `setupHint` eski istemciler için duruyor; `SecurityMonitors.tsx` önce `hint`'i (`HintBox`) gösterir.

## Çoklu sunucu
Uzak sunucuda yalnız SSH anahtar denetimi çalışır; diğerleri yerel (karar: P5).

## Önemli kararlar ve tuzaklar
- Panel ban EKLEYEMEZ, yalnız okur ve kaldırır (paneli ele geçiren "istediğim IP'yi kes" düğmesi bulmasın).
- Trivy ilk turda DB indirir (dakikalar); zaman aşımı ayrı ayar, DB kalıcı volume'de.
- Trivy günlüğü stderr'e, JSON stdout'a yazıyor — `ExecResult.stdout` ayrımı bu yüzden var.
