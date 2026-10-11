/**
 * Container giriş noktası (CMD).
 *
 *  - PANEL_ROLE=central (varsayılan): Next'i YALNIZCA 127.0.0.1'de başlatır ve
 *    önüne düz HTTP bir ön katman koyar (aşağıda, `startFront`).
 *  - PANEL_ROLE=agent: TLS sertifikasını (yoksa) üretir, Next'i YALNIZCA
 *    127.0.0.1'de başlatır ve önüne izinli yolları ileten bir HTTPS katmanı
 *    koyar. Dışarıdan erişilebilen tek şey /api/agent/* ve /api/health —
 *    arayüz sayfaları ajanda hiç yayınlanmaz.
 *
 * Sertifika self-signed; güveni CA değil, merkezin kayıt anında sabitlediği
 * parmak izi sağlar. Veri volume'ü silinirse yeni sertifika üretilir ve
 * sunucunun merkezde yeniden kaydedilmesi gerekir (bilerek: sessizce yeni
 * sertifikaya güvenmek, araya girmeye kapı açardı).
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import http from "node:http";
import https from "node:https";
import path from "node:path";

if (process.env.PANEL_ROLE !== "agent") {
  await startFront();
} else {
  const dir = path.join(process.env.DATA_DIR ?? "/app/data", "agent");
  const keyPath = path.join(dir, "key.pem");
  const certPath = path.join(dir, "cert.pem");

  if (!existsSync(certPath) || !existsSync(keyPath)) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const result = spawnSync(
      "openssl",
      [
        "req", "-x509", "-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:prime256v1",
        "-nodes", "-keyout", keyPath, "-out", certPath, "-days", "3650",
        "-subj", "/CN=panel-agent",
      ],
      { stdio: "inherit" },
    );
    if (result.status !== 0) {
      console.error("[agent] TLS sertifikası üretilemedi (openssl)"); // i18n-ignore — operatör logu
      process.exit(1);
    }
  }

  const internalPort = Number(process.env.PORT ?? 3000);
  process.env.AGENT_CERT = certPath;
  process.env.HOSTNAME = "127.0.0.1";
  process.env.PORT = String(internalPort);
  await import("./server.js");

  const ALLOWED = /^\/api\/(agent\/(rpc|stream|enroll)|health)(\?|$)/;
  const server = https.createServer(
    { key: readFileSync(keyPath), cert: readFileSync(certPath) },
    (req, res) => {
      if (!ALLOWED.test(req.url ?? "")) {
        res.writeHead(404).end();
        return;
      }
      const upstream = http.request(
        {
          host: "127.0.0.1",
          port: internalPort,
          method: req.method,
          path: req.url,
          headers: { ...req.headers, host: `127.0.0.1:${internalPort}` },
        },
        (response) => {
          res.writeHead(response.statusCode ?? 502, response.headers);
          response.pipe(res);
        },
      );
      upstream.on("error", () => {
        if (!res.headersSent) res.writeHead(502);
        res.end();
      });
      // Merkez akışı kapatınca iç isteği de kapat — log takibi sonsuza dek sürmesin.
      res.on("close", () => upstream.destroy());
      req.pipe(upstream);
    },
  );
  // Uzun akışlar (image çekme, log takibi) kesilmesin.
  server.requestTimeout = 0;

  const port = Number(process.env.AGENT_PORT ?? 7443);
  const bind = process.env.AGENT_BIND ?? "0.0.0.0";
  server.listen(port, bind, () => {
    console.log(`[agent] https://${bind}:${port} dinleniyor`); // i18n-ignore — operatör logu
  });
}

/**
 * Merkez rolünün ön katmanı — eskiden Caddy'nin yaptığı tek iş.
 *
 * Panel istemci IP'sini (rate limit, audit, giriş kısıtlaması) ve şemayı
 * (`secure` çerez) `X-Real-IP` / `X-Forwarded-*` başlıklarından okuyor
 * (`src/lib/request.ts`, `src/lib/auth/session.ts`). Next doğrudan dışarı
 * açılsaydı bu başlıkları istemci UYDURABİLİRDİ. Bu katman gelen değerleri
 * siler ve soketin gerçek adresini yazar; Next yalnızca loopback'te dinlediği
 * için başka yoldan ulaşılamaz.
 *
 * `PANEL_TRUST_PROXY=1`: önüne TLS sonlandıran kendi vekilini koyan kurulum
 * için. O zaman gelen `X-Forwarded-For` / `X-Forwarded-Proto` korunur — yalnız
 * panel portu başka hiçbir yere açık değilse kullanılmalı.
 */
async function startFront() {
  const publicPort = Number(process.env.PORT ?? 3000);
  const publicBind = process.env.HOSTNAME ?? "0.0.0.0";
  const internalPort = Number(process.env.PANEL_INTERNAL_PORT ?? 3001);
  const trustProxy = process.env.PANEL_TRUST_PROXY === "1";

  process.env.HOSTNAME = "127.0.0.1";
  process.env.PORT = String(internalPort);
  await import("./server.js");

  const server = http.createServer((req, res) => {
    const remote = (req.socket.remoteAddress ?? "").replace(/^::ffff:/, "");
    const headers = { ...req.headers };
    const forwarded = trustProxy ? String(headers["x-forwarded-for"] ?? "").split(",")[0].trim() : "";
    const proto = trustProxy ? String(headers["x-forwarded-proto"] ?? "").split(",")[0].trim() : "";
    delete headers["x-real-ip"];
    delete headers["x-forwarded-for"];
    delete headers["x-forwarded-proto"];
    headers["x-real-ip"] = forwarded || remote;
    headers["x-forwarded-for"] = forwarded || remote;
    headers["x-forwarded-proto"] = proto === "https" ? "https" : "http";

    const upstream = http.request(
      { host: "127.0.0.1", port: internalPort, method: req.method, path: req.url, headers },
      (response) => {
        res.writeHead(response.statusCode ?? 502, response.headers);
        response.pipe(res);
      },
    );
    upstream.on("error", () => {
      if (!res.headersSent) res.writeHead(502);
      res.end();
    });
    // İstemci giderse iç isteği de kapat — log/çekme akışları sürüp gitmesin.
    res.on("close", () => upstream.destroy());
    req.pipe(upstream);
  });
  // Uzun akışlar (image çekme, log takibi, SSE) kesilmesin.
  server.requestTimeout = 0;
  server.listen(publicPort, publicBind, () => {
    console.log(`[panel] http://${publicBind}:${publicPort} dinleniyor`); // i18n-ignore — operatör logu
  });
}
