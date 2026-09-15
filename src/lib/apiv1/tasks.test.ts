import assert from "node:assert/strict";
import { describe, it, beforeEach } from "node:test";
import { clearTasks, createTask, finishTask, findTask, updateProgress } from "./tasks.ts";

describe("görev kaydı", () => {
  beforeEach(() => clearTasks());

  it("görevi çalışır durumda açar", () => {
    const task = createTask({ kind: "container.update", ownerUserId: 1, target: "nginx" });
    assert.match(task.id, /^tsk_[0-9a-f]{24}$/);
    assert.equal(task.status, "running");
    assert.equal(task.finishedAt, null);
  });

  it("YALNIZCA sahibine görünür", () => {
    // taskId tahmin edilemez ama yetki kontrolü tahmin edilemezliğe
    // bırakılmaz; bilinen bir sır yetki mekanizması değildir.
    const task = createTask({ kind: "container.update", ownerUserId: 7, target: "nginx" });
    assert.ok(findTask(task.id, 7));
    assert.equal(findTask(task.id, 8), null);
  });

  it("olmayan görev için null", () => {
    assert.equal(findTask("tsk_yok", 1), null);
  });

  it("ilerleme yazılır", () => {
    const task = createTask({ kind: "container.update", ownerUserId: 1, target: "nginx" });
    updateProgress(task.id, "Pulling 42%");
    assert.equal(findTask(task.id, 1)?.progress, "Pulling 42%");
  });

  it("başarıyla biter", () => {
    const task = createTask({ kind: "container.update", ownerUserId: 1, target: "nginx" });
    finishTask(task.id, { status: "succeeded", detail: "1.27 → 1.29" });

    const done = findTask(task.id, 1);
    assert.equal(done?.status, "succeeded");
    assert.equal(done?.detail, "1.27 → 1.29");
    assert.ok(done?.finishedAt !== null);
    assert.equal(done?.error, null);
  });

  it("hatayla biter", () => {
    const task = createTask({ kind: "container.update", ownerUserId: 1, target: "nginx" });
    finishTask(task.id, { status: "failed", error: "kayıt defterine ulaşılamadı" });

    const done = findTask(task.id, 1);
    assert.equal(done?.status, "failed");
    assert.equal(done?.error, "kayıt defterine ulaşılamadı");
  });

  it("bitmiş göreve ilerleme yazılmaz", () => {
    const task = createTask({ kind: "container.update", ownerUserId: 1, target: "nginx" });
    finishTask(task.id, { status: "succeeded", detail: "tamam" });
    updateProgress(task.id, "geç kalan satır");
    assert.equal(findTask(task.id, 1)?.progress, "");
  });

  it("100 kayıt sınırını aşınca en eskiler düşer", () => {
    // TTL tek başına yetmez: bir saat içinde 100'den fazla görev açılabilir.
    const first = createTask({ kind: "t", ownerUserId: 1, target: "ilk" });
    for (let i = 0; i < 110; i += 1) {
      createTask({ kind: "t", ownerUserId: 1, target: `x${i}` });
    }
    assert.equal(findTask(first.id, 1), null, "en eski kayıt düşmeliydi");
  });
});
