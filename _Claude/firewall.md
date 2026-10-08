# Güvenlik duvarı — /firewall
Son güncelleme: 2026-10-08 · commit 428d5e8

## Ne yapar
ufw durumu, varsayılan politikalar (gelen/giden/yönlendirilen), kurallar; kural ekleme/silme, açma/kapama, loglama. Port haritasıyla hangi portun hangi kurala takıldığı gösterilir; kendini kilitleme riski olan değişikliklerde ek onay ister.

## Dosyalar
- Sayfa: `src/app/(panel)/firewall/page.tsx` — `requirePermission("security.view")`; YALNIZ YEREL.
- Ekran: `FirewallScreen.tsx` (489).
- API: `src/app/api/firewall/route.ts` GET (`security.view`), POST (`security.manage`) — `{ localOnly: true }`.
- lib:
  - `src/lib/security/firewall.ts` — helper çağrıları (`ufw_*` action'ları, `host-helper/panel-helper.py`).
  - `src/lib/security/ufw.ts` — saf: ufw çıktısı ayrıştırma, `dangerousChange` (testli).
  - `src/lib/security/{ports,portmap}.ts` — port haritası (bkz. `ports.md`).
- Locale: `firewall.*`.

## Önemli kararlar ve tuzaklar
- Kural söz dizimi HOST tarafında (helper) doğrulanır: yalnız `port/proto` ya da `from <ip> to any port <n>`. Serbest metin ufw'ye geçmez.
- `dangerousChange` yanlış "sorun yok" derse kullanıcı sunucuya erişimini kaybeder — değiştirirken testleri genişlet.
- fail2ban: `security.md`.
