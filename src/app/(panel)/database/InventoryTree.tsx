"use client";

import { useState } from "react";
import { AlertTriangle, Box, ChevronDown, ChevronRight, Database, KeyRound, Plus, Server, Users } from "lucide-react";
import { ENGINE_LABEL, type DbConnection, type InventoryInstance } from "@/lib/dbadmin/types";
import { formatBytes } from "@/lib/metrics/catalog";
import { useFormat, useT } from "@/lib/i18n/client";

/**
 * Sol panel: seçili sunucudaki DB sunucuları (envanter) → veritabanları,
 * altında elle eklenen bağlantılar.
 */

export type Selection = { connectionId: number; database: string | null };

export function InventoryTree({
  instances,
  loading,
  manual,
  selection,
  canWrite,
  onSelect,
  onCredentials,
  onUsers,
  onCreateDb,
}: {
  instances: InventoryInstance[] | null;
  loading: boolean;
  manual: DbConnection[];
  selection: Selection | null;
  canWrite: boolean;
  onSelect: (selection: Selection) => void;
  onCredentials: (instance: InventoryInstance) => void;
  onUsers: (instance: InventoryInstance) => void;
  onCreateDb: (instance: InventoryInstance) => void;
}) {
  const t = useT();
  const f = useFormat();
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [showSystem, setShowSystem] = useState(false);

  const toggle = (key: string) =>
    setCollapsed((previous) => {
      const next = new Set(previous);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const iconButton =
    "rounded p-1 text-subtle transition-colors hover:bg-line/60 hover:text-ink disabled:opacity-40";

  return (
    <aside className="rounded-lg border border-line bg-surface">
      <div className="flex items-center justify-between border-b border-line px-3 py-2 text-xs font-semibold text-subtle">
        <span>{t("database.inventory.title")}</span>
        <label className="flex items-center gap-1 font-normal">
          <input
            type="checkbox"
            checked={showSystem}
            onChange={(e) => setShowSystem(e.target.checked)}
            className="size-3 accent-[var(--brand)]"
          />
          {t("database.inventory.showSystem")}
        </label>
      </div>

      <ul className="max-h-[40rem] overflow-y-auto">
        {instances === null && (
          <li className="px-3 py-6 text-center text-xs text-subtle">{t("database.inventory.scanning")}</li>
        )}
        {instances !== null && instances.length === 0 && !loading && (
          <li className="px-3 py-6 text-center text-xs text-subtle">{t("database.inventory.none")}</li>
        )}

        {(instances ?? []).map((instance) => {
          const open = !collapsed.has(instance.key);
          const databases = instance.databases.filter((entry) => showSystem || !entry.system);
          const sqlite = instance.engine === "sqlite";
          const admin = canWrite && !sqlite && instance.engine !== "redis" && instance.state === "running";
          return (
            <li key={instance.key} className="border-b border-line last:border-b-0">
              <div className="flex items-center gap-1 px-2 py-1.5">
                <button
                  type="button"
                  onClick={() => toggle(instance.key)}
                  className="flex min-w-0 flex-1 items-center gap-1.5 text-left text-xs"
                >
                  {open ? (
                    <ChevronDown className="size-3.5 shrink-0 text-subtle" aria-hidden />
                  ) : (
                    <ChevronRight className="size-3.5 shrink-0 text-subtle" aria-hidden />
                  )}
                  {instance.transport === "docker" ? (
                    <Box className="size-3.5 shrink-0 text-subtle" aria-label={t("database.inventory.docker")} />
                  ) : (
                    <Server className="size-3.5 shrink-0 text-subtle" aria-label={t("database.inventory.native")} />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{instance.label}</span>
                    <span className="block truncate text-[11px] text-subtle">
                      {ENGINE_LABEL[instance.engine]} ·{" "}
                      {sqlite
                        ? t("database.inventory.files", { count: instance.databases.length })
                        : instance.transport === "docker"
                          ? t("database.inventory.docker")
                          : t("database.inventory.native")}
                      {instance.state === "stopped" && ` · ${t("database.inventory.stopped")}`}
                    </span>
                  </span>
                </button>
                {canWrite && !sqlite && (
                  <button
                    type="button"
                    onClick={() => onCredentials(instance)}
                    title={t("database.inventory.credentials")}
                    className={`${iconButton} ${instance.credentials === "missing" ? "text-warn" : ""}`}
                  >
                    <KeyRound className="size-3.5" />
                  </button>
                )}
                {admin && (
                  <>
                    <button
                      type="button"
                      onClick={() => onUsers(instance)}
                      title={t("database.users.title")}
                      className={iconButton}
                    >
                      <Users className="size-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => onCreateDb(instance)}
                      title={t("database.createDb.title")}
                      className={iconButton}
                    >
                      <Plus className="size-3.5" />
                    </button>
                  </>
                )}
              </div>

              {open && instance.error && (
                <p className="mx-2 mb-2 flex gap-1.5 rounded bg-danger/10 px-2 py-1.5 text-[11px] text-danger">
                  <AlertTriangle className="mt-0.5 size-3 shrink-0" aria-hidden />
                  <span className="min-w-0 break-words">{instance.error}</span>
                </p>
              )}

              {open && (instance.state === "running" || sqlite) && !instance.error && (
                <ul className="pb-1">
                  {databases.length === 0 && (
                    <li className="px-8 py-1 text-[11px] text-subtle">{t("database.inventory.noDatabases")}</li>
                  )}
                  {databases.map((entry) => {
                    // SQLite dosyası kendi bağlantısı; sunucudaki DB, sunucunun bağlantısı + ad.
                    const target: Selection = entry.connectionId
                      ? { connectionId: entry.connectionId, database: null }
                      : { connectionId: instance.connectionId, database: entry.name };
                    const selected =
                      selection?.connectionId === target.connectionId && selection.database === target.database;
                    return (
                      <li key={entry.name}>
                        <button
                          type="button"
                          onClick={() => onSelect(target)}
                          title={entry.path}
                          className={`flex w-full items-center gap-2 py-1 pl-8 pr-3 text-left text-xs transition-colors hover:bg-line/40 ${
                            selected ? "bg-brand/10 text-brand" : entry.system ? "text-subtle" : ""
                          }`}
                        >
                          <Database className="size-3 shrink-0 opacity-60" aria-hidden />
                          <span className="min-w-0 flex-1 truncate">{entry.name}</span>
                          <span className="shrink-0 tabular-nums text-[11px] text-subtle">
                            {entry.sizeBytes !== null
                              ? formatBytes(entry.sizeBytes)
                              : entry.tables !== null
                                ? t("database.inventory.keys", { count: f.number(entry.tables) })
                                : ""}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </li>
          );
        })}
      </ul>

      {manual.length > 0 && (
        <>
          <div className="border-y border-line px-3 py-2 text-xs font-semibold text-subtle">
            {t("database.inventory.saved")}
          </div>
          <ul className="max-h-60 overflow-y-auto pb-1">
            {manual.map((connection) => {
              const selected = selection?.connectionId === connection.id;
              return (
                <li key={connection.id}>
                  <button
                    type="button"
                    onClick={() => onSelect({ connectionId: connection.id, database: null })}
                    className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors hover:bg-line/40 ${
                      selected ? "bg-brand/10 text-brand" : ""
                    }`}
                  >
                    <Database className="size-3.5 shrink-0 text-subtle" aria-hidden />
                    <span className="min-w-0 flex-1 truncate">{connection.name}</span>
                    <span className="shrink-0 text-[11px] text-subtle">{ENGINE_LABEL[connection.engine]}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </aside>
  );
}
