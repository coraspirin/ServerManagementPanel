import "server-only";

import { lstat, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { onHost } from "@/lib/hosts/on-host";
import type { DbEngine, NativeMeta } from "../types";

/**
 * Host'a doğrudan kurulu (apt/systemd) veritabanı sunucuları.
 *
 * Panel container'ında `127.0.0.1` host değil ve servisler çoğunlukla yalnız
 * loopback'te dinliyor; bu yüzden ağdan değil SOKETTEN gidiliyor. Soketin
 * varlığı servisin çalıştığını, systemd biriminin varlığı kurulu olduğunu
 * gösteriyor. Okuma `/host/root` üzerinden — dosya sistemine dokunduğu için
 * uzak sunucuda ajan yapıyor (`db.native`).
 */

export type NativeInstance = {
  key: string;
  engine: DbEngine;
  port: number;
  meta: NativeMeta;
};

const HOST_ROOT = process.env.HOST_ROOT ?? "/host/root";

function hostPath(target: string): string {
  return path.posix.join(HOST_ROOT, target);
}

async function isSocket(target: string): Promise<boolean> {
  try {
    return (await lstat(hostPath(target))).isSocket();
  } catch {
    return false;
  }
}

async function exists(target: string): Promise<boolean> {
  try {
    await lstat(hostPath(target));
    return true;
  } catch {
    return false;
  }
}

async function list(target: string): Promise<string[]> {
  try {
    return await readdir(hostPath(target));
  } catch {
    return [];
  }
}

/** Etkin (enabled) systemd birimlerinden ilk eşleşen. */
async function enabledUnit(names: string[]): Promise<string | null> {
  const wants = await list("/etc/systemd/system/multi-user.target.wants");
  for (const name of names) {
    if (wants.includes(`${name}.service`)) return name;
    const prefixed = wants.find((entry) => entry.startsWith(`${name}@`));
    if (prefixed) return prefixed.replace(/\.service$/, "");
  }
  return null;
}

async function passwdEntry(user: string): Promise<{ uid: number; gid: number } | null> {
  try {
    const text = await readFile(hostPath("/etc/passwd"), "utf8");
    for (const line of text.split("\n")) {
      const parts = line.split(":");
      if (parts[0] === user && parts.length >= 4) return { uid: Number(parts[2]), gid: Number(parts[3]) };
    }
  } catch {
    // passwd okunamadı.
  }
  return null;
}

const MYSQL_SOCKETS = ["/run/mysqld/mysqld.sock", "/var/lib/mysql/mysql.sock", "/tmp/mysql.sock"];
const REDIS_SOCKETS = ["/run/redis/redis-server.sock", "/run/redis/redis.sock", "/var/run/redis/redis-server.sock"];

async function findMysql(): Promise<NativeInstance[]> {
  const service = await enabledUnit(["mariadb", "mysql", "mysqld"]);
  let socket: string | null = null;
  for (const candidate of MYSQL_SOCKETS) {
    if (await isSocket(candidate)) {
      socket = candidate;
      break;
    }
  }
  if (!socket && !service) return [];

  const debianCnf = await exists("/etc/mysql/debian.cnf");
  return [
    {
      key: `native:mysql:${socket ?? service}`,
      engine: "mysql",
      port: 3306,
      meta: {
        ...(socket ? { socket } : { stopped: true }),
        ...(debianCnf ? { debianCnf: true } : {}),
        service: service ?? "mysql",
      },
    },
  ];
}

async function findPostgres(): Promise<NativeInstance[]> {
  const found: NativeInstance[] = [];
  const service = await enabledUnit(["postgresql"]);
  const owner = await passwdEntry("postgres");

  for (const directory of ["/run/postgresql", "/tmp"]) {
    for (const entry of await list(directory)) {
      const match = entry.match(/^\.s\.PGSQL\.(\d+)$/);
      if (!match || !(await isSocket(`${directory}/${entry}`))) continue;
      const port = Number(match[1]);
      found.push({
        key: `native:postgres:${port}`,
        engine: "postgres",
        port,
        meta: {
          socket: directory,
          ...(owner ? { uid: owner.uid, gid: owner.gid } : {}),
          service: service ?? "postgresql",
        },
      });
    }
  }

  if (found.length === 0 && service) {
    found.push({
      key: "native:postgres:5432",
      engine: "postgres",
      port: 5432,
      meta: { stopped: true, service },
    });
  }
  return found;
}

async function findRedis(): Promise<NativeInstance[]> {
  const service = await enabledUnit(["redis-server", "redis", "valkey-server", "valkey"]);
  let socket: string | null = null;
  for (const candidate of REDIS_SOCKETS) {
    if (await isSocket(candidate)) {
      socket = candidate;
      break;
    }
  }
  if (!socket && !service) return [];

  // Soket yoksa TCP (host ağında 127.0.0.1:6379) denenir — Redis soketi
  // varsayılan olarak kapalı geliyor.
  return [
    {
      key: "native:redis:6379",
      engine: "redis",
      port: 6379,
      meta: { ...(socket ? { socket } : {}), service: service ?? "redis" },
    },
  ];
}

export async function localDiscoverNative(): Promise<NativeInstance[]> {
  if (!(await exists("/etc"))) return [];
  const groups = await Promise.all([findMysql(), findPostgres(), findRedis()]);
  return groups.flat();
}

export function discoverNative(): Promise<NativeInstance[]> {
  return onHost("db.native", [], () => localDiscoverNative());
}
