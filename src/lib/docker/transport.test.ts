import assert from "node:assert/strict";
import http from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import {
  bindDockerTransport,
  dockerTransport,
  localDockerTransport,
  type DockerReply,
  type DockerStreamReply,
  type DockerTransport,
} from "./transport.ts";

/** Sahte taşıma: hangi taşımanın kullanıldığını yanıt gövdesine yazar. */
function fake(name: string): DockerTransport {
  return {
    kind: "remote",
    async request(): Promise<DockerReply> {
      return { status: 200, headers: {}, body: Buffer.from(name) };
    },
    async stream(): Promise<DockerStreamReply> {
      async function* body() {
        yield Buffer.from(name);
      }
      return { status: 200, headers: {}, body: body(), close() {} };
    },
  };
}

const provider = {
  async who(): Promise<string> {
    return (await dockerTransport().request({ path: "/_ping" })).body.toString();
  },
  async twice(this: { who(): Promise<string> }): Promise<string[]> {
    return [await this.who(), await this.who()];
  },
  async *steps(): AsyncGenerator<string> {
    yield (await dockerTransport().request({ path: "/_ping" })).body.toString();
    await new Promise((resolve) => setTimeout(resolve, 1));
    yield (await dockerTransport().request({ path: "/_ping" })).body.toString();
  },
};

describe("bindDockerTransport", () => {
  it("bağlam yokken yerel taşıma", () => {
    assert.equal(dockerTransport().kind, "local");
  });

  it("metot ve iç `this` çağrıları bağlı taşımayı görür", async () => {
    const bound = bindDockerTransport(provider, fake("pi"));
    assert.equal(await bound.who(), "pi");
    assert.deepEqual(await bound.twice(), ["pi", "pi"]);
  });

  it("paralel iki sunucu birbirinin taşımasını görmez", async () => {
    const a = bindDockerTransport(provider, fake("a"));
    const b = bindDockerTransport(provider, fake("b"));
    assert.deepEqual(await Promise.all([a.twice(), b.twice()]), [["a", "a"], ["b", "b"]]);
  });

  it("üreteçte her adım bağlı taşımada çalışır", async () => {
    const bound = bindDockerTransport(provider, fake("pi"));
    const seen: string[] = [];
    for await (const value of bound.steps()) seen.push(value);
    assert.deepEqual(seen, ["pi", "pi"]);
  });
});

describe("localDockerTransport", () => {
  // Windows'ta Unix soketi yerine adlandırılmış boru; node:http ikisini de `socketPath` ile açar.
  const socketPath =
    process.platform === "win32"
      ? `\\\\.\\pipe\\panel-transport-test-${process.pid}`
      : path.join(tmpdir(), `panel-transport-test-${process.pid}.sock`);
  let server: http.Server;
  let lastBody = "";

  before(async () => {
    server = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (chunk: Buffer) => chunks.push(chunk));
      req.on("end", () => {
        lastBody = Buffer.concat(chunks).toString();
        if (req.url?.startsWith("/events")) {
          res.writeHead(200, { "content-type": "application/json" });
          res.write('{"a":1}\n');
          setTimeout(() => res.end('{"a":2}\n'), 5);
          return;
        }
        if (req.url === "/idle") {
          // Node'un varsayılan ajanının 5 sn boşta kalma süresinden uzun sessizlik.
          res.writeHead(200);
          res.write("a");
          setTimeout(() => res.end("b"), 5_600);
          return;
        }
        if (req.url === "/slow") return; // yanıt yok → zaman aşımı
        res.writeHead(req.url === "/missing" ? 404 : 200, { "content-type": "application/json" });
        res.end(JSON.stringify({ method: req.method, url: req.url, type: req.headers["content-type"] ?? null }));
      });
    });
    await new Promise<void>((resolve) => server.listen(socketPath, resolve));
  });

  after(() => new Promise<void>((resolve) => server.close(() => resolve())));

  it("ara bellekli istek: yöntem, yol, gövde, durum", async () => {
    const transport = localDockerTransport(socketPath);
    const reply = await transport.request({
      method: "POST",
      path: "/containers/create?name=x",
      headers: { "content-type": "application/json" },
      body: '{"Image":"nginx"}',
    });
    assert.equal(reply.status, 200);
    assert.deepEqual(JSON.parse(reply.body.toString()), {
      method: "POST",
      url: "/containers/create?name=x",
      type: "application/json",
    });
    assert.equal(lastBody, '{"Image":"nginx"}');
    assert.equal((await transport.request({ path: "/missing" })).status, 404);
  });

  it("akış: parçalar geldikçe okunur", async () => {
    const reply = await localDockerTransport(socketPath).stream({ path: "/events" });
    assert.equal(reply.status, 200);
    let text = "";
    for await (const chunk of reply.body) text += chunk.toString();
    reply.close();
    assert.equal(text, '{"a":1}\n{"a":2}\n');
  });

  it("süresiz akış 5 sn'den uzun sessizlikte kopmaz (2026-10-14 regresyonu)", { timeout: 15_000 }, async () => {
    const reply = await localDockerTransport(socketPath).stream({ path: "/idle" });
    let text = "";
    for await (const chunk of reply.body) text += chunk.toString();
    reply.close();
    assert.equal(text, "ab");
  });

  it("zaman aşımı hata olarak döner", async () => {
    await assert.rejects(localDockerTransport(socketPath).request({ path: "/slow", timeoutMs: 50 }));
  });
});
