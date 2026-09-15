import { loadFixture } from "@/lib/fixtures";
import type { SystemInfo, SystemProvider } from "./types";

export const mockSystemProvider: SystemProvider = {
  info(): Promise<SystemInfo> {
    return loadFixture<SystemInfo>("system");
  },
};
