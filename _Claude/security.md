# Güvenlik — /security
Son güncelleme: 2026-10-08 · commit 428d5e8

## Ne yapar
Güvenlik monitörleri: SSH yetkili anahtar denetimi, fail2ban ban listesi + başarısız girişler (ban kaldırma), UPnP port yönlendirme envanteri, Docker imaj CVE taraması (Trivy). Port haritası ve güvenlik duvarı ayrı sayfalara bağlantı verir.

## Dosyalar
- Sayfa: `src/app/(panel)/security/page.tsx` — `requirePermission("security.view")`, `pageHostId({ agent: true })`.
- Ekran: `SecurityScreen.tsx` (115); asıl içerik `src/components/security/SecurityMonitors.tsx` (558).
- API:
  - `src/app/api/security/monitor/route.ts` GET — `security.view`; `mode=ssh` ise `{ agent: true }`, diğerleri `{ localOnly: true }`; POST `security.manage` (localOnly)
  - `src/app/api/security/route.ts` GET — `security.view`, localOnly
- lib: `src/lib/security/sshkeys.ts`, `fail2ban.ts` (helper), `upnp.ts` (IGD sorgusu), `vuln.ts` (Trivy geçici container; DB `panel-trivy-cache` volume'ünde).
- Tablolar: `port_forwards`, `vuln_scans` (`017_security.ts`).
- Locale: `secmon.*`, `securityScreen.*`.

## Çoklu sunucu
Uzak sunucuda yalnız SSH anahtar denetimi çalışır; diğerleri yerel (karar: P5).

## Önemli kararlar ve tuzaklar
- Panel ban EKLEYEMEZ, yalnız okur ve kaldırır (paneli ele geçiren "istediğim IP'yi kes" düğmesi bulmasın).
- Trivy ilk turda DB indirir (dakikalar); zaman aşımı ayrı ayar, DB kalıcı volume'de.
- Trivy günlüğü stderr'e, JSON stdout'a yazıyor — `ExecResult.stdout` ayrımı bu yüzden var.
