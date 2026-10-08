import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseCsv, parseMysqlBatch, parsePgTag } from "./parse.ts";

describe("parseMysqlBatch", () => {
  it("başlık + satırlar, kaçışlar ve NULL", () => {
    const text = "id\tad\tnot\n1\tAyşe\tsatır\\nsonu\n2\tse\\tkme\tNULL\n";
    assert.deepEqual(parseMysqlBatch(text), {
      columns: ["id", "ad", "not"],
      rows: [
        ["1", "Ayşe", "satır\nsonu"],
        ["2", "se\tkme", null],
      ],
    });
  });

  it("ters bölü ve boş çıktı", () => {
    assert.deepEqual(parseMysqlBatch("yol\nC:\\\\x\n").rows, [["C:\\x"]]);
    assert.deepEqual(parseMysqlBatch(""), { columns: [], rows: [] });
  });
});

describe("parseCsv", () => {
  it("NULL (tırnaksız boş) ile boş metni ayırır", () => {
    const text = 'a,b,c\n1,,""\n"x, ""y""",2,"çok\nsatır"\n';
    assert.deepEqual(parseCsv(text), {
      columns: ["a", "b", "c"],
      rows: [
        ["1", null, ""],
        ['x, "y"', "2", "çok\nsatır"],
      ],
    });
  });

  it("CRLF ve yalnız başlık", () => {
    assert.deepEqual(parseCsv("x\r\n1\r\n"), { columns: ["x"], rows: [["1"]] });
    assert.deepEqual(parseCsv("x\n"), { columns: ["x"], rows: [] });
  });
});

describe("parsePgTag", () => {
  it("etkilenen satır sayısı", () => {
    assert.deepEqual(parsePgTag("UPDATE 3\n"), { tag: "UPDATE 3", affected: 3 });
    assert.deepEqual(parsePgTag("INSERT 0 1"), { tag: "INSERT 0 1", affected: 1 });
    assert.deepEqual(parsePgTag("CREATE TABLE"), { tag: "CREATE TABLE", affected: null });
    assert.equal(parsePgTag("id,ad\n1,x"), null);
  });
});
