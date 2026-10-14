/**
 * Sembolik bağ çözümü (güvenlik incelemesi 2026-10-14).
 *
 * Asıl iddia: yazma işleminin bind edeceği klasör, host köküne göre
 * çözülür — izinli kökteki `bag → /etc` kök dışı (`/etc`) olarak görünür ve
 * `write.ts` onu reddeder. Mutlak hedef container'ın değil host'un köküne
 * göre yorumlanır.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { insideRoots, LinkLoopError, resolveHostPath } from "./resolve.ts";

function links(map: Record<string, string>) {
  return (hostPath: string) => map[hostPath] ?? null;
}

describe("resolveHostPath", () => {
  it("bağ yoksa yol aynen döner (var olmayan parçalar dahil)", () => {
    assert.equal(resolveHostPath("/data/a/yeni", links({})), "/data/a/yeni");
  });

  it("mutlak hedefli bağ host köküne göre çözülür", () => {
    const read = links({ "/data/bag": "/etc" });
    assert.equal(resolveHostPath("/data/bag", read), "/etc");
    assert.equal(resolveHostPath("/data/bag/cron.d", read), "/etc/cron.d");
  });

  it("göreli hedef bağın klasörüne göre, `..` kökte durur", () => {
    const read = links({ "/data/bag": "../../../../etc" });
    assert.equal(resolveHostPath("/data/bag", read), "/etc");
    assert.equal(resolveHostPath("/data/x/../y", links({})), "/data/y");
  });

  it("zincirleme bağlar ve köklerin kendisi bağ", () => {
    const read = links({ "/data": "/mnt/disk", "/mnt/disk/a": "b" });
    assert.equal(resolveHostPath("/data/a/c", read), "/mnt/disk/b/c");
  });

  it("döngü sonsuza gitmez", () => {
    const read = links({ "/a": "/b", "/b": "/a" });
    assert.throws(() => resolveHostPath("/a/x", read), LinkLoopError);
  });

  it("izin hatası çağırana fırlatılır (yükseltilmiş yola düşmek için)", () => {
    const read = () => {
      throw new Error("EACCES: permission denied");
    };
    assert.throws(() => resolveHostPath("/home/u/x", read), /EACCES/);
  });
});

describe("insideRoots", () => {
  it("önek değil klasör sınırı", () => {
    assert.equal(insideRoots("/data", ["/data"]), true);
    assert.equal(insideRoots("/data/x", ["/data"]), true);
    assert.equal(insideRoots("/database", ["/data"]), false);
    assert.equal(insideRoots("/etc", ["/"]), true);
  });
});
