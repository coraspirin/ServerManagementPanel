import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { currentHostId, hasHostContext, hostSettingsOverlay, runWithHost } from "./context.ts";

const tick = () => new Promise((resolve) => setTimeout(resolve, 1));

describe("host bağlamı", () => {
  it("bağlam yokken yerel sunucu", () => {
    assert.equal(currentHostId(), 1);
    assert.equal(hasHostContext(), false);
  });

  it("await boyunca korunur", async () => {
    await runWithHost(2, async () => {
      await tick();
      assert.equal(currentHostId(), 2);
    });
    assert.equal(currentHostId(), 1);
  });

  it("paralel çalışan sunucular birbirinin bağlamını görmez", async () => {
    const seen = await Promise.all(
      [2, 3, 4].map((id) =>
        runWithHost(id, async () => {
          await tick();
          const first = currentHostId();
          await tick();
          return [first, currentHostId()];
        }),
      ),
    );
    assert.deepEqual(seen, [
      [2, 2],
      [3, 3],
      [4, 4],
    ]);
  });

  it("ayar katmanı yalnızca kendi bağlamında görünür", () => {
    runWithHost(2, () => assert.deepEqual(hostSettingsOverlay(), { "files.roots": "/srv" }), {
      settings: { "files.roots": "/srv" },
    });
    runWithHost(3, () => assert.equal(hostSettingsOverlay(), undefined));
  });
});
