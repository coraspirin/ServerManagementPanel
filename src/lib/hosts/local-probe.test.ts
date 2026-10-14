import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { decideLocal, type LocalMounts } from "./local-probe.ts";

const NONE: LocalMounts = { docker: false, proc: false, root: false };
const ALL: LocalMounts = { docker: true, proc: true, root: true };

describe("decideLocal", () => {
  it("üç mount da yoksa etkin yerel kapatılır", () => {
    assert.equal(decideLocal(NONE, { enabled: true, autoDisabled: false }), "disable");
  });

  it("zaten kapalıysa dokunulmaz", () => {
    assert.equal(decideLocal(NONE, { enabled: false, autoDisabled: true }), "keep");
    assert.equal(decideLocal(NONE, { enabled: false, autoDisabled: false }), "keep");
  });

  it("tek bir mount bile varsa yerel etkin kalır", () => {
    for (const key of ["docker", "proc", "root"] as const) {
      assert.equal(decideLocal({ ...NONE, [key]: true }, { enabled: true, autoDisabled: false }), "keep");
    }
  });

  it("panel kapattıysa mount'lar gelince yeniden açılır", () => {
    assert.equal(decideLocal(ALL, { enabled: false, autoDisabled: true }), "enable");
    assert.equal(decideLocal({ ...NONE, docker: true }, { enabled: false, autoDisabled: true }), "enable");
  });

  it("kullanıcının elle kapattığı yerel açılmaz", () => {
    assert.equal(decideLocal(ALL, { enabled: false, autoDisabled: false }), "keep");
  });

  it("mount'lar varken etkin yerel aynı kalır", () => {
    assert.equal(decideLocal(ALL, { enabled: true, autoDisabled: false }), "keep");
  });
});
