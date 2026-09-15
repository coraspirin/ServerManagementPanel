import { loadFixture } from "@/lib/fixtures";
import type { HardwareProvider, HardwareReport } from "./types";

type Fixture = Omit<HardwareReport, "notes" | "virtualization">;

let cached: Fixture | null = null;

export const mockHardwareProvider: HardwareProvider = {
  async report(): Promise<HardwareReport> {
    cached ??= await loadFixture<Fixture>("hardware");

    // Rapor zamanı fixture'da sabit; "eskimiş rapor" uyarısı sürekli
    // tetiklenmesin diye şimdiye çekiliyor.
    return {
      ...cached,
      reportedAt: Math.floor(Date.now() / 1000) - 900,
      virtualization: null,
      notes: [],
    };
  },
};
