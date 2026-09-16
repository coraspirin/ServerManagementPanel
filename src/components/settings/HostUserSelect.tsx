"use client";

import { useEffect, useState } from "react";
import type { HostAccounts, HostGroup, HostUser } from "@/lib/host/users";
import { useT } from "@/lib/i18n/client";

/**
 * Host kullanıcısı seçicileri (M3.45).
 *
 * İki biçim var çünkü iki ayrı depolama biçimi kullanılıyor ve ikisi de
 * DEĞİŞMİYOR: host cron satırı kullanıcı ADINI ("root"), compose dosya sahibi
 * ise NUMARALARI ("1000:1000") istiyor. Ortak olan şey listenin kaynağı.
 *
 * Liste okunamazsa (host kökü bağlı değil) ikisi de düz metin kutusuna
 * düşüyor. Alternatif — alanı kilitlemek — panelin okuyamadığı bir şey
 * yüzünden kullanıcının doğru bildiği değeri girememesi olurdu.
 */

const selectClass =
  "w-full rounded-md border border-line bg-canvas px-2 py-1.5 text-sm outline-none focus:border-brand disabled:opacity-50";

/** Modül düzeyinde önbellek: aynı sayfada birden çok seçici olabiliyor. */
let cached: HostAccounts | null = null;

export function useHostAccounts(): HostAccounts | null {
  const t = useT();
  const [data, setData] = useState<HostAccounts | null>(cached);

  useEffect(() => {
    if (cached) return;
    const controller = new AbortController();

    (async () => {
      try {
        const response = await fetch("/api/host/users", {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok) {
          setData({ users: [], groups: [], error: t("hostUser.listFailed") });
          return;
        }
        cached = (await response.json()) as HostAccounts;
        setData(cached);
      } catch (error) {
        if ((error as Error)?.name !== "AbortError") {
          setData({ users: [], groups: [], error: t("common.errors.network") });
        }
      }
    })();

    return () => controller.abort();
  }, [t]);

  return data;
}

function label(user: HostUser): string {
  const who = user.comment && user.comment !== user.name ? ` (${user.comment})` : "";
  return `${user.name}${who} · ${user.uid}`;
}

/** Kullanıcı ADI döndürür — host cron satırındaki alan. */
export function HostUserSelect({
  value,
  disabled,
  onChange,
  className = "",
}: {
  value: string;
  disabled?: boolean;
  onChange: (value: string) => void;
  className?: string;
}) {
  const t = useT();
  const accounts = useHostAccounts();

  if (!accounts || accounts.users.length === 0) {
    return (
      <input
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        placeholder={accounts ? "root" : t("common.states.loadingInline")}
        className={`${selectClass} font-mono ${className}`}
      />
    );
  }

  // Kayıtlı değer listede yoksa (kullanıcı silinmiş, host değişmiş) seçenek
  // olarak EKLENİYOR: aksi halde select ilk sıradakine kayar ve kullanıcı
  // formu kaydettiğinde farkında olmadan görevin sahibini değiştirir.
  const known = accounts.users.some((user) => user.name === value);

  return (
    <select
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      className={`${selectClass} font-mono ${className}`}
    >
      {!known && value !== "" && (
        <option value={value}>{t("hostUser.notOnHost", { name: value })}</option>
      )}
      {accounts.users.map((user) => (
        <option key={user.name} value={user.name}>
          {label(user)}
        </option>
      ))}
    </select>
  );
}

function ownerParts(value: string): { uid: string; gid: string } {
  const [uid = "0", gid = "0"] = value.split(":");
  return { uid: uid.trim(), gid: gid.trim() };
}

/** "uid:gid" döndürür — compose dosyalarının sahibi. */
export function OwnerSelect({
  value,
  disabled,
  onCommit,
}: {
  value: string;
  disabled: boolean;
  onCommit: (value: string) => void;
}) {
  const t = useT();
  const accounts = useHostAccounts();
  const { uid, gid } = ownerParts(value);

  if (!accounts || accounts.users.length === 0) {
    return (
      <input
        value={value}
        disabled={disabled}
        onChange={(e) => onCommit(e.target.value)}
        placeholder={accounts ? "0:0" : t("common.states.loadingInline")}
        className={`${selectClass} font-mono sm:w-40`}
      />
    );
  }

  const knownUid = accounts.users.some((user) => String(user.uid) === uid);
  const knownGid = accounts.groups.some((group: HostGroup) => String(group.gid) === gid);

  return (
    <div className="w-full space-y-1 sm:w-64">
      <label className="block">
        <span className="text-[11px] text-subtle">{t("hostUser.user")}</span>
        <select
          value={uid}
          disabled={disabled}
          onChange={(e) => {
            // Kullanıcı seçilince grubu da onun BİRİNCİL grubuna çekiyoruz:
            // "1000:0" gibi bir karışım neredeyse her zaman yanlış ve elle
            // düzeltilmesi gereken ikinci bir adım olurdu.
            const picked = accounts.users.find((user) => String(user.uid) === e.target.value);
            onCommit(picked ? `${picked.uid}:${picked.gid}` : `${e.target.value}:${gid}`);
          }}
          className={`${selectClass} font-mono`}
        >
          {!knownUid && (
            <option value={uid}>{t("hostUser.notOnHost", { name: `uid ${uid}` })}</option>
          )}
          {accounts.users.map((user) => (
            <option key={user.uid} value={user.uid}>
              {label(user)}
            </option>
          ))}
        </select>
      </label>

      <label className="block">
        <span className="text-[11px] text-subtle">{t("hostUser.group")}</span>
        <select
          value={gid}
          disabled={disabled}
          onChange={(e) => onCommit(`${uid}:${e.target.value}`)}
          className={`${selectClass} font-mono`}
        >
          {!knownGid && (
            <option value={gid}>{t("hostUser.notOnHost", { name: `gid ${gid}` })}</option>
          )}
          {accounts.groups.map((group) => (
            <option key={group.gid} value={group.gid}>
              {group.name} · {group.gid}
            </option>
          ))}
        </select>
      </label>

      <p className="font-mono text-[11px] text-subtle">{value}</p>
    </div>
  );
}
