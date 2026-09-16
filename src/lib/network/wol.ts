import "server-only";
import { serverT } from "@/lib/i18n/runtime";

import dgram from "node:dgram";
import net from "node:net";
import { getDb } from "@/lib/db/client";

/**
 * M2.11 — Wake-on-LAN.
 *
 * Sihirli paket elle kuruluyor; bunun için bir paket eklemeye değmez: 6 bayt
 * 0xFF + MAC'in 16 kez tekrarı, toplam 102 bayt.
 *
 * ⚠️ Paket yayın (broadcast) adresine gider ve Docker köprüsünden çıkan bir
 *    yayın paketi LAN'a ULAŞMAZ — köprü ayrı bir yayın alanıdır. Bu yüzden
 *    varsayılan `255.255.255.255` çoğu kurulumda işe yaramaz ve kullanıcıya
 *    LAN'ın yönlendirilmiş yayın adresi (ör. 192.168.61.255) sorulur; o adres
 *    yönlendirilebilir bir hedef olduğu için köprüden çıkabilir.
 */

export type WolDevice = {
  id: number;
  name: string;
  mac: string;
  broadcast: string;
  port: number;
  checkHost: string;
  lastSentAt: number | null;
};

type Row = {
  id: number;
  name: string;
  mac: string;
  broadcast: string;
  port: number;
  check_host: string;
  last_sent_at: number | null;
};

function toDevice(row: Row): WolDevice {
  return {
    id: row.id,
    name: row.name,
    mac: row.mac,
    broadcast: row.broadcast,
    port: row.port,
    checkHost: row.check_host,
    lastSentAt: row.last_sent_at,
  };
}

/** Girdi biçimi ne olursa olsun tek bir kanonik biçim: küçük harf, iki nokta. */
export function normalizeMac(raw: string): string | null {
  const hex = raw.replace(/[^0-9a-f]/gi, "").toLowerCase();
  if (hex.length !== 12) return null;
  return (hex.match(/.{2}/g) ?? []).join(":");
}

export function listWolDevices(): WolDevice[] {
  return (
    getDb().prepare("SELECT * FROM wol_devices ORDER BY name").all() as Row[]
  ).map(toDevice);
}

export function getWolDevice(id: number): WolDevice | null {
  const row = getDb().prepare("SELECT * FROM wol_devices WHERE id = ?").get(id) as
    | Row
    | undefined;
  return row ? toDevice(row) : null;
}

export type WolInput = {
  name: string;
  mac: string;
  broadcast: string;
  port: number;
  checkHost: string;
};

export function validateWol(input: WolInput): string | null {
  if (!input.name.trim()) return serverT("monitorStore.nameEmpty");
  if (!normalizeMac(input.mac)) return serverT("wolLib.mac");
  if (input.broadcast.trim() && !net.isIPv4(input.broadcast.trim())) {
    return serverT("wolLib.broadcast");
  }
  if (!Number.isInteger(input.port) || input.port < 1 || input.port > 65535) {
    return serverT("proxyStore.portRange");
  }
  return null;
}

export function saveWolDevice(id: number | null, input: WolInput): number {
  const mac = normalizeMac(input.mac)!;
  const db = getDb();

  if (id === null) {
    const result = db
      .prepare(
        "INSERT INTO wol_devices (name, mac, broadcast, port, check_host) VALUES (?, ?, ?, ?, ?)",
      )
      .run(input.name.trim(), mac, input.broadcast.trim(), input.port, input.checkHost.trim());
    return Number(result.lastInsertRowid);
  }

  db.prepare(
    "UPDATE wol_devices SET name = ?, mac = ?, broadcast = ?, port = ?, check_host = ? WHERE id = ?",
  ).run(input.name.trim(), mac, input.broadcast.trim(), input.port, input.checkHost.trim(), id);
  return id;
}

export function deleteWolDevice(id: number): void {
  getDb().prepare("DELETE FROM wol_devices WHERE id = ?").run(id);
}

/** 6×0xFF + MAC×16 = 102 bayt. */
function magicPacket(mac: string): Buffer {
  const address = Buffer.from(mac.replace(/:/g, ""), "hex");
  return Buffer.concat([Buffer.alloc(6, 0xff), ...Array.from({ length: 16 }, () => address)]);
}

export function sendWol(device: WolDevice): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = dgram.createSocket("udp4");
    const target = device.broadcast.trim() || "255.255.255.255";

    socket.once("error", (error) => {
      socket.close();
      reject(error);
    });

    socket.bind(() => {
      socket.setBroadcast(true);
      socket.send(magicPacket(device.mac), device.port, target, (error) => {
        socket.close();
        if (error) reject(error);
        else {
          getDb()
            .prepare("UPDATE wol_devices SET last_sent_at = unixepoch() WHERE id = ?")
            .run(device.id);
          resolve();
        }
      });
    });
  });
}

/**
 * Cihaz uyandı mı.
 *
 * `checkHost` verilmemişse sonuç doğrulanmıyor: WoL tek yönlü bir paket ve
 * "gönderdim" ile "uyandı" farklı şeyler. Kullanıcıya hangisini söylediğimiz
 * açık olmalı.
 */
export function checkAwake(device: WolDevice, timeoutMs = 3000): Promise<boolean | null> {
  const host = device.checkHost.trim();
  if (!host) return Promise.resolve(null);

  return new Promise((resolve) => {
    const socket = new net.Socket();
    const done = (alive: boolean) => {
      socket.destroy();
      resolve(alive);
    };

    socket.setTimeout(timeoutMs);
    socket.once("connect", () => done(true));
    // Reddedilen bağlantı da "makine ayakta" demek.
    socket.once("error", (error: NodeJS.ErrnoException) => done(error.code === "ECONNREFUSED"));
    socket.once("timeout", () => done(false));
    socket.connect(445, host);
  });
}
