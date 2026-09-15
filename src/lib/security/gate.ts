/**
 * Güncelleme öncesi CVE kapısı — karar mantığı (M3.28).
 *
 * Trivy taraması (M3.8) ve imaj güncelleyici (M1.11) bugüne kadar birbirini
 * tanımıyordu: panel bir imajı tarayabiliyor, güncelleyebiliyor, ama "bu
 * güncelleme güvenlik açısından daha kötüye mi gidiyor" sorusunu hiç
 * sormuyordu.
 *
 * ## Neden varsayılan `daha_kotu`
 *
 * Diğer ölçütlerin hepsinin ters bir yan etkisi var: mevcut imajda zaten 5
 * kritik açık varken 3 açıklı yeni imajı engellemek, kullanıcıyı **daha kötü**
 * bir yerde tutmak olur. `daha_kotu` bir iyileşmeyi asla engellemez, bir
 * gerilemeyi asla sessizce kabul etmez.
 *
 * Trivy'miz `--ignore-unfixed` ile çalışıyor; sayılan her açığın bir
 * düzeltmesi var, yani engelleme "yapılabilecek bir şey var" demek.
 *
 * I/O yok, `@/` yolu yok — `node --test` altında doğrudan çalışsın diye saf.
 */

export type GateMode = "kapali" | "kritik" | "kritik_yuksek" | "daha_kotu";

export const GATE_MODES: GateMode[] = ["kapali", "kritik", "kritik_yuksek", "daha_kotu"];

export function isGateMode(value: string): value is GateMode {
  return (GATE_MODES as string[]).includes(value);
}

/** Kapının bakması gereken sayılar; `ScanRow`'un dar bir görünümü. */
export type VulnCounts = { critical: number; high: number; medium: number; low: number };

export type GateVerdict = {
  /** Güncellemeye izin var mı. */
  allowed: boolean;
  /** Kullanıcıya gösterilecek gerekçe — izin verilse de dolu. */
  reason: string;
};

function toplam(counts: VulnCounts): number {
  return counts.critical + counts.high + counts.medium + counts.low;
}

function ozet(counts: VulnCounts): string {
  const parcalar: string[] = [];
  if (counts.critical) parcalar.push(`${counts.critical} kritik`);
  if (counts.high) parcalar.push(`${counts.high} yüksek`);
  if (counts.medium) parcalar.push(`${counts.medium} orta`);
  if (counts.low) parcalar.push(`${counts.low} düşük`);
  return parcalar.length > 0 ? parcalar.join(", ") : "açık yok";
}

/**
 * Yeni imaj güncellemeye uygun mu.
 *
 * @param mode    Ayardan gelen ölçüt.
 * @param fresh   Yeni imajın taraması.
 * @param current Mevcut (çalışan) imajın taraması; bilinmiyorsa `null`.
 */
export function evaluateGate(
  mode: GateMode,
  fresh: VulnCounts,
  current: VulnCounts | null,
): GateVerdict {
  if (mode === "kapali") {
    return { allowed: true, reason: `Tarama: ${ozet(fresh)} (kapı kapalı, engellenmiyor).` };
  }

  if (mode === "kritik") {
    return fresh.critical > 0
      ? {
          allowed: false,
          reason: `Yeni imajda ${fresh.critical} kritik açık var (${ozet(fresh)}).`,
        }
      : { allowed: true, reason: `Kritik açık yok (${ozet(fresh)}).` };
  }

  if (mode === "kritik_yuksek") {
    const engel = fresh.critical + fresh.high;
    return engel > 0
      ? {
          allowed: false,
          reason: `Yeni imajda ${engel} kritik/yüksek açık var (${ozet(fresh)}).`,
        }
      : { allowed: true, reason: `Kritik ya da yüksek açık yok (${ozet(fresh)}).` };
  }

  // daha_kotu
  if (current === null) {
    // Mevcut imajın taraması yoksa karşılaştıracak bir şey yok. ENGELLEMİYORUZ:
    // bilinmezliği "kötü" saymak, tarama yapılamayan her imajı güncellenemez
    // hâle getirirdi.
    return {
      allowed: true,
      reason:
        `Mevcut imajın taraması yok, karşılaştırma yapılamadı — engellenmedi. ` +
        `Yeni imaj: ${ozet(fresh)}.`,
    };
  }

  const yeni = toplam(fresh);
  const eski = toplam(current);

  if (yeni > eski) {
    return {
      allowed: false,
      reason:
        `Yeni imaj daha fazla açık taşıyor: ${yeni} (${ozet(fresh)}) ` +
        `↔ mevcut ${eski} (${ozet(current)}).`,
    };
  }

  return {
    allowed: true,
    reason:
      yeni < eski
        ? `İyileşme: ${eski} açıktan ${yeni} açığa (${ozet(fresh)}).`
        : `Açık sayısı değişmedi: ${yeni} (${ozet(fresh)}).`,
  };
}
