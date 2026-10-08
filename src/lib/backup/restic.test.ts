/**
 * restic komut kurucuları ve `--json` ayrıştırıcılarının sözleşme testleri.
 *
 * En kritik iddialar: saklama kuralı HİÇBİR ZAMAN boş `forget` üretmez
 * (restic boş kuralla tüm snapshot'ları siler); `--group-by tags` her zaman
 * vardır (kaynak listesi değişince eski gruplar temizlenmeden kalmasın);
 * restic'in JSON önüne yazdığı uyarı satırları ayrıştırmayı bozmaz.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  backupArgs,
  countRemoved,
  detectAnomaly,
  forgetArgs,
  looksLocked,
  looksUninitialized,
  mountVolumeOptions,
  parseDf,
  parseDiff,
  parseLs,
  parseResticLine,
  parseSnapshots,
  parseStats,
  repositoryUrl,
  restoreArgs,
  retentionMax,
  slug,
  splitSmbLocation,
} from "./restic.ts";

describe("konum adresleri", () => {
  it("yerel ve NFS konumu container içindeki /repo'dur", () => {
    assert.equal(repositoryUrl("local", "/mnt/yedek"), "/repo");
    assert.equal(repositoryUrl("nfs", "nas:/volume1/yedek"), "/repo");
  });

  it("SMB alt klasörü depo yoluna eklenir, paylaşım aygıt olur", () => {
    assert.deepEqual(splitSmbLocation("//nas/yedek/sunucu/panel/"), { device: "//nas/yedek", subPath: "/sunucu/panel" });
    assert.equal(repositoryUrl("smb", "//nas/yedek/sunucu"), "/repo/sunucu");
    assert.equal(repositoryUrl("smb", "//nas/yedek"), "/repo");
  });

  it("bulut konumları olduğu gibi gider", () => {
    assert.equal(repositoryUrl("s3", "s3:https://s3.example.com/kova/yol"), "s3:https://s3.example.com/kova/yol");
  });

  it("SMB volume seçenekleri kimlik bilgisini ve root izinlerini taşır", () => {
    const options = mountVolumeOptions("smb", "//nas/yedek/alt", { SMB_USERNAME: "ali", SMB_PASSWORD: "gizli" });
    assert.equal(options.type, "cifs");
    assert.equal(options.device, "//nas/yedek");
    assert.match(options.o, /username=ali/);
    assert.match(options.o, /password=gizli/);
    assert.match(options.o, /uid=0/);
  });

  it("kullanıcısız SMB misafir bağlanır", () => {
    assert.match(mountVolumeOptions("smb", "//nas/yedek", {}).o, /^guest,/);
  });

  it("NFS adresi addr + aygıt yoluna ayrılır", () => {
    const options = mountVolumeOptions("nfs", "192.168.1.5:/volume1/yedek", {});
    assert.deepEqual(options, { type: "nfs", device: ":/volume1/yedek", o: "addr=192.168.1.5,rw,nfsvers=4" });
  });
});

describe("argüman kurucular", () => {
  it("backup: yollar, etiket, host, hariç tutulanlar ve hız sınırı", () => {
    const args = backupArgs({
      paths: ["/src", "/stage/job-3"],
      tags: ["panel-docker-h1"],
      host: "panel-h1-docker",
      excludes: ["*.log", "  "],
      limitUploadKb: 512,
    });
    assert.deepEqual(args, [
      "backup", "/src", "/stage/job-3", "--json", "--host", "panel-h1-docker",
      "--tag", "panel-docker-h1", "--exclude", "*.log", "--limit-upload", "512",
    ]);
  });

  it("forget: yalnızca sıfırdan büyük kurallar, her zaman etiket grubu ve prune", () => {
    const args = forgetArgs("panel-os-h1", { last: 7, daily: 0, weekly: 4, monthly: 0 });
    assert.deepEqual(args, [
      "forget", "--tag", "panel-os-h1", "--group-by", "tags", "--prune", "--json",
      "--keep-last", "7", "--keep-weekly", "4",
    ]);
    assert.equal(retentionMax({ last: 7, daily: 0, weekly: 4, monthly: 0 }), 11);
  });

  it("restore: alt klasör, seçimler ve birebir mod", () => {
    assert.deepEqual(restoreArgs("abc12345:/host", ["/etc/hosts"], { overwrite: true }), [
      "restore", "abc12345:/host", "--target", "/restore", "--json", "--include", "/etc/hosts", "--overwrite", "if-changed",
    ]);
    assert.deepEqual(restoreArgs("abc12345", [], { exact: true, target: "/tmp/x" }), [
      "restore", "abc12345", "--target", "/tmp/x", "--json", "--overwrite", "always", "--delete",
    ]);
  });
});

describe("ayrıştırıcılar", () => {
  it("durum satırı yüzdeye ve sayaçlara çevrilir", () => {
    const line = parseResticLine(
      '{"message_type":"status","percent_done":0.25,"total_files":100,"files_done":25,"total_bytes":4000,"bytes_done":1000,"seconds_remaining":30,"current_files":["/src/a","/src/b"]}',
    );
    assert.equal(line.type, "status");
    if (line.type !== "status") return;
    assert.equal(line.progress.percent, 25);
    assert.equal(line.progress.filesDone, 25);
    assert.equal(line.progress.secondsRemaining, 30);
    assert.deepEqual(line.progress.currentFiles, ["/src/a", "/src/b"]);
  });

  it("restore durum satırı (files_restored / bytes_restored) da okunur", () => {
    const line = parseResticLine('{"message_type":"status","percent_done":1,"files_restored":3,"bytes_restored":30,"total_bytes":30}');
    assert.equal(line.type === "status" && line.progress.bytesDone, 30);
  });

  it("özet satırı", () => {
    const line = parseResticLine(
      '{"message_type":"summary","files_new":6,"files_changed":58,"data_added":480000000,"total_files_processed":900,"total_bytes_processed":5000000000,"snapshot_id":"deadbeefcafe"}',
    );
    assert.deepEqual(line, {
      type: "summary",
      summary: { snapshotId: "deadbeefcafe", filesNew: 6, filesChanged: 58, filesTotal: 900, bytesAdded: 480000000, bytesProcessed: 5000000000 },
    });
  });

  it("hata satırı ve düz metin", () => {
    assert.deepEqual(parseResticLine('{"message_type":"error","error":{"message":"permission denied"},"item":"/src/x"}'), {
      type: "error",
      message: "permission denied",
      item: "/src/x",
    });
    assert.deepEqual(parseResticLine("repository is already locked"), { type: "text", text: "repository is already locked" });
  });

  it("snapshot listesi: önündeki uyarıya rağmen okunur, en yeni önce", () => {
    const output =
      'warning: something\n[{"time":"2026-09-14T02:00:00Z","id":"aaa","short_id":"a","paths":["/data"],"tags":["t"],"hostname":"h"},' +
      '{"time":"2026-09-15T02:00:00Z","id":"bbb","short_id":"b","paths":["/data"],"hostname":"h","summary":{"total_bytes_processed":10,"total_files_processed":2}}]';
    const snapshots = parseSnapshots(output);
    assert.deepEqual(snapshots.map((snapshot) => snapshot.id), ["bbb", "aaa"]);
    assert.equal(snapshots[0].sizeBytes, 10);
    assert.equal(snapshots[1].sizeBytes, null);
  });

  it("ls: yalnızca doğrudan çocuklar, önce klasörler", () => {
    const output = [
      '{"struct_type":"snapshot","id":"x"}',
      '{"struct_type":"node","name":"etc","type":"dir","path":"/host/etc"}',
      '{"message_type":"node","name":"z.txt","type":"file","path":"/host/etc/z.txt","size":5,"mtime":"2026-09-01T00:00:00Z"}',
      '{"struct_type":"node","name":"apt","type":"dir","path":"/host/etc/apt"}',
      '{"struct_type":"node","name":"deep","type":"file","path":"/host/etc/apt/deep"}',
    ].join("\n");
    const entries = parseLs(output, "/host/etc");
    assert.deepEqual(entries.map((entry) => entry.name), ["apt", "z.txt"]);
    assert.equal(entries[1].size, 5);
  });

  it("diff ve istatistik", () => {
    const output = [
      '{"message_type":"change","path":"/a","modifier":"+"}',
      '{"message_type":"change","path":"/b","modifier":"-"}',
      '{"message_type":"change","path":"/c","modifier":"M"}',
      '{"message_type":"statistics","added":{"bytes":100},"removed":{"bytes":40}}',
    ].join("\n");
    assert.deepEqual(parseDiff(output), { added: ["/a"], removed: ["/b"], changed: ["/c"], addedBytes: 100, removedBytes: 40 });
  });

  it("stats, forget ve df", () => {
    assert.deepEqual(parseStats('{"total_size":50,"total_uncompressed_size":120,"snapshots_count":7}'), {
      storedBytes: 50,
      rawBytes: 120,
      snapshots: 7,
    });
    assert.equal(countRemoved('[{"remove":[{},{}]},{"remove":null},{"remove":[{}]}]'), 3);
    assert.deepEqual(parseDf("Filesystem 1024-blocks Used Available Capacity Mounted on\n/dev/sda1 1000 900 100 90% /repo\n"), {
      totalBytes: 1000 * 1024,
      freeBytes: 100 * 1024,
    });
  });

  it("deponun yokluğu ve kilit tanınır", () => {
    assert.equal(looksUninitialized("", 10), true);
    assert.equal(looksUninitialized("Fatal: unable to open config file: stat /repo/config: no such file or directory", 1), true);
    assert.equal(looksUninitialized("Fatal: wrong password", 12), false);
    assert.equal(looksLocked("unable to create lock in backend: repository is already locked by PID 1"), true);
  });
});

describe("anormal boyut", () => {
  const history = Array.from({ length: 5 }, () => ({ bytesAdded: 50 * 1024 * 1024, filesTotal: 1000 }));

  it("az geçmişle karar vermez", () => {
    assert.equal(detectAnomaly({ bytesAdded: 10 ** 12, filesTotal: 0 }, history.slice(0, 2)), null);
  });

  it("ortalamanın 5 katı büyüme (en az 100 MB) uyarır", () => {
    assert.equal(detectAnomaly({ bytesAdded: 300 * 1024 * 1024, filesTotal: 1000 }, history)?.kind, "growth");
    assert.equal(detectAnomaly({ bytesAdded: 90 * 1024 * 1024, filesTotal: 1000 }, history), null);
  });

  it("dosya sayısında %30'dan fazla düşüş uyarır", () => {
    assert.equal(detectAnomaly({ bytesAdded: 0, filesTotal: 600 }, history)?.kind, "shrink");
    assert.equal(detectAnomaly({ bytesAdded: 0, filesTotal: 800 }, history), null);
  });
});

it("slug güvenli yol bileşeni üretir", () => {
  assert.equal(slug("/var/lib/home assistant/"), "var_lib_home_assistant");
  assert.equal(slug("/"), "root");
});
