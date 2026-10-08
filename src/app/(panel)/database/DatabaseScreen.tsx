"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  Download,
  History,
  Lock,
  Play,
  Plus,
  RefreshCw,
  Star,
  Table2,
  Trash2,
  Unlock,
} from "lucide-react";
import { Modal } from "@/components/Modal";
import { withHostQuery } from "@/lib/client/host";
import type { HistoryEntry, SavedQuery } from "@/lib/dbadmin/store";
import {
  DEFAULT_PORT,
  ENGINE_LABEL,
  type DbConnection,
  type DbEngine,
  type DbStructure,
  type DbTable,
  type InventoryInstance,
  type QueryResult,
} from "@/lib/dbadmin/types";
import { useFormat, useT } from "@/lib/i18n/client";
import { Rich } from "@/lib/i18n/rich";
import { CreateDbModal, CredentialsModal, UsersModal } from "./AdminModals";
import { call } from "./api";
import { InventoryTree, type Selection } from "./InventoryTree";

/**
 * M3.6 — veritabanı yöneticisi.
 *
 * Sol panel seçili sunucunun ENVANTERİ: Docker container'larındaki ve host'a
 * kurulu DB sunucuları kendiliğinden bulunur, içlerindeki veritabanları
 * boyutlarıyla listelenir. Elle eklenen bağlantılar (uzak sunucu, SQLite
 * dosyası) altta ayrıca durur.
 *
 * Ekranın en görünür mesajı yine yazma korumasıdır: her bağlantının başında
 * bir kilit simgesi var ve salt-okunur olan bağlantıda SQL editörü yazma
 * denemesini sunucuya gönderip net bir cevap alarak reddediyor (kural tek
 * yerde, istemcide kopyası yok).
 */

type Payload = {
  connections: DbConnection[];
  history: HistoryEntry[];
  saved: SavedQuery[];
};

const inputClass =
  "mt-1 w-full rounded-md border border-line bg-canvas px-3 py-1.5 text-sm outline-none focus:border-brand";

const smallButton =
  "rounded-md border border-line px-2.5 py-1.5 text-xs transition-colors hover:border-brand disabled:opacity-50";

export function DatabaseScreen({
  initial,
  canWrite,
}: {
  initial: Payload;
  canWrite: boolean;
}) {
  const t = useT();
  const f = useFormat();
  const [data, setData] = useState(initial);
  const [inventory, setInventory] = useState<InventoryInstance[] | null>(null);
  const [inventoryErrors, setInventoryErrors] = useState<string[]>([]);
  const [scanning, setScanning] = useState(false);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [tables, setTables] = useState<DbTable[]>([]);
  const [table, setTable] = useState<DbTable | null>(null);
  const [structure, setStructure] = useState<DbStructure | null>(null);
  const [tab, setTab] = useState<"data" | "structure" | "query">("data");
  const [result, setResult] = useState<QueryResult | null>(null);
  const [sql, setSql] = useState("");
  const [offset, setOffset] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pendingConfirm, setPendingConfirm] = useState<{ dangers: string[] } | null>(null);
  const [draft, setDraft] = useState<Partial<DbConnection> & { password?: string } | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [credentialsFor, setCredentialsFor] = useState<InventoryInstance | null>(null);
  const [usersFor, setUsersFor] = useState<InventoryInstance | null>(null);
  const [createFor, setCreateFor] = useState<InventoryInstance | null>(null);
  const dumpFrame = useRef<HTMLIFrameElement | null>(null);

  const PAGE = 100;

  const active = selection ? (data.connections.find((entry) => entry.id === selection.connectionId) ?? null) : null;
  const activeInstance = selection
    ? (inventory?.find(
        (entry) =>
          entry.connectionId === selection.connectionId ||
          entry.databases.some((database) => database.connectionId === selection.connectionId),
      ) ?? null)
    : null;
  const activeDbInfo =
    activeInstance?.databases.find((entry) =>
      entry.connectionId ? entry.connectionId === selection?.connectionId : entry.name === selection?.database,
    ) ?? null;
  const activeDatabase = selection?.database ?? null;
  const manual = data.connections.filter((entry) => !entry.instanceKey);
  const title = activeInstance
    ? `${activeInstance.label}${activeDbInfo ? ` / ${activeDbInfo.name}` : ""}`
    : (active?.name ?? "");

  /** Envanterde seçilen veritabanı isteklere eklenir; elle bağlantıda yok. */
  const databaseParam = (current: Selection | null) =>
    current?.database !== null && current?.database !== undefined
      ? `&database=${encodeURIComponent(current.database)}`
      : "";
  const databaseBody = (current: Selection | null) =>
    current?.database !== null && current?.database !== undefined ? { database: current.database } : {};

  const loadInventory = useCallback(async () => {
    setScanning(true);
    try {
      const { response, payload } = await call("/api/database?mode=inventory", "GET");
      if (!response.ok) {
        setInventoryErrors([String(payload.error ?? t("database.inventory.failed"))]);
        setInventory((previous) => previous ?? []);
        return null;
      }
      const instances = (payload.instances as InventoryInstance[]) ?? [];
      setInventory(instances);
      setInventoryErrors((payload.errors as string[]) ?? []);
      // Envanter yeni bağlantı satırları açmış olabilir (kimlik, yetki bayrağı).
      const list = await call("/api/database", "GET");
      if (list.response.ok && list.payload.connections) {
        setData((previous) => ({ ...previous, connections: list.payload.connections as DbConnection[] }));
      }
      return instances;
    } finally {
      setScanning(false);
    }
  }, [t]);

  const loadTables = useCallback(
    async (current: Selection) => {
      setBusy(true);
      setError(null);
      setTables([]);
      setTable(null);
      setResult(null);
      setStructure(null);
      try {
        const { response, payload } = await call(
          `/api/database?mode=tables&id=${current.connectionId}${databaseParam(current)}`,
          "GET",
        );
        if (!response.ok) {
          setError(String(payload.error ?? t("database.tablesFailed")));
          return;
        }
        setTables((payload.tables as DbTable[]) ?? []);
      } finally {
        setBusy(false);
      }
    },
    [t],
  );

  function select(next: Selection) {
    setSelection(next);
    setTab("data");
    void loadTables(next);
  }

  // İlk açılış: envanter taranır, ilk çalışan sunucunun ilk kullanıcı
  // veritabanı (yoksa ilk kayıtlı bağlantı) seçilir.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const instances = await loadInventory();
      if (cancelled || selection) return;
      for (const instance of instances ?? []) {
        const first = instance.databases.find((entry) => !entry.system);
        if (instance.state === "running" && first) {
          select(
            first.connectionId
              ? { connectionId: first.connectionId, database: null }
              : { connectionId: instance.connectionId, database: first.name },
          );
          return;
        }
      }
      const fallback = initial.connections.find((entry) => !entry.instanceKey);
      if (fallback) select({ connectionId: fallback.id, database: null });
    })();
    return () => {
      cancelled = true;
    };
    // Yalnız ilk açılışta.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function openTable(entry: DbTable, nextOffset = 0) {
    if (!selection) return;
    setBusy(true);
    setError(null);
    setTable(entry);
    setTab("data");
    try {
      const { response, payload } = await call("/api/database/query", "POST", {
        connectionId: selection.connectionId,
        ...databaseBody(selection),
        mode: "table",
        schema: entry.schema,
        table: entry.name,
        limit: PAGE,
        offset: nextOffset,
      });
      if (!response.ok) {
        setError(String(payload.error ?? t("database.tableFailed")));
        return;
      }
      setResult(payload.result as QueryResult);
      setOffset(nextOffset);
    } finally {
      setBusy(false);
    }
  }

  async function loadStructure(entry: DbTable) {
    if (!selection) return;
    setBusy(true);
    setTab("structure");
    setTable(entry);
    try {
      const { response, payload } = await call(
        `/api/database?mode=structure&id=${selection.connectionId}${databaseParam(selection)}&schema=${encodeURIComponent(
          entry.schema,
        )}&table=${encodeURIComponent(entry.name)}`,
        "GET",
      );
      if (!response.ok) {
        setError(String(payload.error ?? t("database.structureFailed")));
        return;
      }
      setStructure(payload.structure as DbStructure);
    } finally {
      setBusy(false);
    }
  }

  async function execute(confirmed = false) {
    if (!selection) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    setPendingConfirm(null);
    try {
      const { response, payload } = await call("/api/database/query", "POST", {
        connectionId: selection.connectionId,
        ...databaseBody(selection),
        sql,
        confirmed,
      });

      if (response.status === 409) {
        setPendingConfirm({ dangers: (payload.dangers as string[]) ?? [] });
        return;
      }
      if (!response.ok) {
        setError(String(payload.error ?? t("database.queryFailed")));
        return;
      }

      const outcome = payload.result as QueryResult;
      setResult(outcome);
      setTable(null);
      setNotice(
        outcome.affected !== null
          ? t("database.affected", { count: outcome.affected, ms: outcome.durationMs })
          : t("database.rows", { count: outcome.rowCount, ms: outcome.durationMs }) +
              (outcome.truncated ? t("database.truncated") : ""),
      );
      if (payload.history) setData((previous) => ({ ...previous, history: payload.history as HistoryEntry[] }));
    } finally {
      setBusy(false);
    }
  }

  async function manage(body: Record<string, unknown>, method = "POST") {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const { response, payload } = await call("/api/database", method, body);
      if (payload.connections) {
        setData((previous) => ({ ...previous, connections: payload.connections as DbConnection[] }));
      }
      if (payload.saved) {
        setData((previous) => ({ ...previous, saved: payload.saved as SavedQuery[] }));
      }
      if (!response.ok) {
        setError(String(payload.error ?? t("common.errors.actionFailed")));
        return false;
      }
      if (payload.message) setNotice(String(payload.message));
      return true;
    } finally {
      setBusy(false);
    }
  }

  async function dropDatabase() {
    if (!activeInstance || !activeDatabase) return;
    const typed = prompt(t("database.dropDb.confirm", { name: activeDatabase }));
    if (typed === null) return;
    setBusy(true);
    setError(null);
    try {
      const { response, payload } = await call("/api/database/admin", "POST", {
        connectionId: activeInstance.connectionId,
        action: "drop-db",
        database: activeDatabase,
        confirm: typed.trim(),
      });
      if (!response.ok) {
        setError(String(payload.error ?? t("common.errors.actionFailed")));
        return;
      }
      setNotice(t("database.dropDb.done", { name: activeDatabase }));
      setSelection(null);
      setTables([]);
      setTable(null);
      setResult(null);
      await loadInventory();
    } finally {
      setBusy(false);
    }
  }

  /**
   * Döküm gizli bir iframe'e indirilir: büyük dosya tarayıcı belleğine
   * alınmaz. Uç hata verirse (JSON) iframe sayfa olarak yüklenir ve içerik
   * okunup gösterilir — aynı köken olduğu için okunabiliyor.
   */
  function downloadDump() {
    if (!activeInstance || !activeDatabase) return;
    dumpFrame.current?.remove();
    const frame = document.createElement("iframe");
    frame.style.display = "none";
    frame.addEventListener("load", () => {
      try {
        const text = frame.contentDocument?.body?.textContent ?? "";
        if (text) setError(String((JSON.parse(text) as { error?: string }).error ?? text));
      } catch {
        // İndirme başladıysa belge boş ya da erişilemez.
      }
    });
    frame.src = withHostQuery(
      `/api/database/dump?id=${activeInstance.connectionId}&database=${encodeURIComponent(activeDatabase)}`,
    );
    document.body.appendChild(frame);
    dumpFrame.current = frame;
    setNotice(t("database.dump.started", { name: activeDatabase }));
  }

  function exportResult(format: "csv" | "json") {
    if (!result) return;
    const content =
      format === "json"
        ? JSON.stringify(
            result.rows.map((row) =>
              Object.fromEntries(result.columns.map((column, index) => [column, row[index]])),
            ),
            null,
            2,
          )
        : [
            result.columns.join(","),
            ...result.rows.map((row) =>
              row.map((value) => `"${String(value ?? "").replaceAll('"', '""')}"`).join(","),
            ),
          ].join("\n");

    const blob = new Blob([format === "csv" ? "﻿" + content : content], {
      type: format === "csv" ? "text/csv;charset=utf-8" : "application/json",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${t("database.exportName")}.${format}`;
    link.click();
    URL.revokeObjectURL(url);
  }

  const canDump = Boolean(
    activeInstance && activeDatabase && activeInstance.engine !== "redis" && activeInstance.engine !== "sqlite",
  );
  const canDrop = Boolean(canWrite && canDump && activeDbInfo && !activeDbInfo.system);

  return (
    <div className="space-y-4">
      <section className="flex flex-wrap items-center gap-2 rounded-lg border border-line bg-surface p-3">
        <button
          type="button"
          disabled={scanning}
          onClick={() => void loadInventory()}
          className={`flex items-center gap-1.5 ${smallButton}`}
        >
          <RefreshCw className={`size-3.5 ${scanning ? "animate-spin" : ""}`} /> {t("database.inventory.rescan")}
        </button>
        <span className="text-xs text-subtle">
          {inventory === null
            ? t("database.inventory.scanning")
            : t("database.inventory.summary", {
                servers: inventory.length,
                databases: inventory.reduce(
                  (sum, instance) => sum + instance.databases.filter((entry) => !entry.system).length,
                  0,
                ),
              })}
        </span>
        <div className="ml-auto flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setShowHistory(true)}
            className={`flex items-center gap-1.5 ${smallButton}`}
          >
            <History className="size-3.5" /> {t("database.history")}
          </button>
          {canWrite && (
            <button
              type="button"
              onClick={() => setDraft({ engine: "sqlite", name: "", host: "", port: 0, writable: false })}
              className="flex items-center gap-1.5 rounded-md bg-brand px-2.5 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90"
            >
              <Plus className="size-3.5" /> {t("database.connection")}
            </button>
          )}
        </div>
      </section>

      {inventoryErrors.map((message) => (
        <p key={message} role="alert" className="flex gap-2 rounded-lg bg-warn/10 px-4 py-2.5 text-sm text-warn">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden /> {message}
        </p>
      ))}
      {error && (
        <p role="alert" className="whitespace-pre-wrap rounded-lg bg-danger/10 px-4 py-2.5 text-sm text-danger">
          {error}
        </p>
      )}
      {notice && <p className="rounded-lg bg-ok/10 px-4 py-2.5 text-sm text-ok">{notice}</p>}

      {pendingConfirm && (
        <div className="rounded-lg border border-danger/50 bg-danger/5 p-4">
          <p className="flex items-center gap-2 text-sm font-medium text-danger">
            <AlertTriangle className="size-4" aria-hidden /> {t("database.confirmTitle")}
          </p>
          <ul className="mt-2 list-inside list-disc text-sm text-danger">
            {pendingConfirm.dangers.map((danger) => (
              <li key={danger}>{danger}</li>
            ))}
          </ul>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={() => setPendingConfirm(null)}
              className="rounded-md border border-line px-3 py-1.5 text-sm"
            >
              {t("common.actions.cancel")}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void execute(true)}
              className="rounded-md bg-danger px-3 py-1.5 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {t("database.confirmRun")}
            </button>
          </div>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[17rem_1fr]">
        <InventoryTree
          instances={inventory}
          loading={scanning}
          manual={manual}
          selection={selection}
          canWrite={canWrite}
          onSelect={select}
          onCredentials={setCredentialsFor}
          onUsers={setUsersFor}
          onCreateDb={setCreateFor}
        />

        {!active ? (
          <div className="rounded-lg border border-dashed border-line bg-surface px-5 py-12 text-center">
            <Table2 className="mx-auto size-8 text-subtle" aria-hidden />
            <p className="mt-3 text-sm">{t("database.pickDatabase")}</p>
            <p className="mt-1 text-xs text-subtle">{t("database.emptyHelp")}</p>
          </div>
        ) : (
          <div className="min-w-0 space-y-3">
            <section className="flex flex-wrap items-center gap-2 rounded-lg border border-line bg-surface p-3">
              <span className="min-w-0 truncate text-sm font-medium">{title}</span>
              <span className="text-xs text-subtle">{ENGINE_LABEL[active.engine]}</span>

              <button
                type="button"
                disabled={!canWrite || busy}
                onClick={() =>
                  activeInstance
                    ? void manage({ action: "writable", id: active.id, writable: !active.writable })
                    : setDraft({ ...active, password: "" })
                }
                className={`flex items-center gap-1 rounded px-2 py-1 text-xs font-medium disabled:cursor-default ${
                  active.writable ? "bg-warn/15 text-warn" : "bg-ok/10 text-ok"
                }`}
                title={active.writable ? t("database.writableTitle") : t("database.readonlyTitle")}
              >
                {active.writable ? <Unlock className="size-3" /> : <Lock className="size-3" />}
                {active.writable ? t("database.writable") : t("database.readonly")}
              </button>

              {!active.passwordReadable && (
                <span className="flex items-center gap-1 rounded bg-danger/10 px-2 py-1 text-xs text-danger">
                  <AlertTriangle className="size-3" /> {t("database.passwordUnreadable")}
                </span>
              )}

              <div className="ml-auto flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void manage({ action: "test", id: active.id })}
                  className={smallButton}
                >
                  {t("database.testConnection")}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => selection && void loadTables(selection)}
                  title={t("database.refreshTables")}
                  className="rounded-md border border-line p-1.5 text-subtle transition-colors hover:text-ink disabled:opacity-50"
                >
                  <RefreshCw className={`size-3.5 ${busy ? "animate-spin" : ""}`} />
                </button>
                {canDump && (
                  <button
                    type="button"
                    onClick={downloadDump}
                    className={`flex items-center gap-1.5 ${smallButton}`}
                    title={t("database.dump.title")}
                  >
                    <Download className="size-3.5" /> {t("database.dump.button")}
                  </button>
                )}
                {canDrop && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void dropDatabase()}
                    title={t("database.dropDb.title")}
                    className="rounded border border-line p-1.5 text-subtle transition-colors hover:text-danger disabled:opacity-50"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                )}
                {canWrite && !activeInstance && (
                  <>
                    <button
                      type="button"
                      onClick={() => setDraft({ ...active, password: "" })}
                      className={smallButton}
                    >
                      {t("common.actions.edit")}
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      title={t("database.deleteConnection")}
                      onClick={async () => {
                        if (confirm(t("database.confirmDelete", { name: active.name }))) {
                          const { response, payload } = await call(`/api/database?id=${active.id}`, "DELETE");
                          if (response.ok) {
                            setData((previous) => ({
                              ...previous,
                              connections: (payload.connections as DbConnection[]) ?? [],
                            }));
                            setSelection(null);
                            setTables([]);
                            setTable(null);
                            setResult(null);
                          } else {
                            setError(String(payload.error ?? t("docker.resources.removeFailed")));
                          }
                        }
                      }}
                      className="rounded border border-line p-1.5 text-subtle transition-colors hover:text-danger disabled:opacity-50"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </>
                )}
              </div>
            </section>

            <div className="grid gap-3 xl:grid-cols-[15rem_1fr]">
              <aside className="rounded-lg border border-line bg-surface">
                <div className="border-b border-line px-3 py-2 text-xs font-semibold text-subtle">
                  {t("database.tables")} {tables.length > 0 && `(${tables.length})`}
                </div>
                <ul className="max-h-[32rem] divide-y divide-line overflow-y-auto">
                  {tables.length === 0 && (
                    <li className="px-3 py-6 text-center text-xs text-subtle">
                      {busy ? t("database.reading") : t("database.noTables")}
                    </li>
                  )}
                  {tables.map((entry) => (
                    <li key={`${entry.schema}.${entry.name}`}>
                      <button
                        type="button"
                        onClick={() => void openTable(entry)}
                        className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors hover:bg-line/40 ${
                          table?.name === entry.name && table?.schema === entry.schema
                            ? "bg-brand/10 text-brand"
                            : ""
                        }`}
                      >
                        <Table2 className="size-3.5 shrink-0 text-subtle" aria-hidden />
                        <span className="min-w-0 flex-1 truncate">
                          {entry.schema !== "main" &&
                            entry.schema !== "keyspace" &&
                            entry.schema !== "public" &&
                            entry.schema !== activeDatabase && <span className="text-subtle">{entry.schema}.</span>}
                          {entry.name}
                        </span>
                        <span className="shrink-0 tabular-nums text-subtle">
                          {entry.rowCount === null ? "?" : f.number(entry.rowCount)}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </aside>

              <div className="min-w-0 space-y-3">
                <div className="flex flex-wrap gap-1 border-b border-line">
                  {(
                    [
                      ["data", t("database.tab.data")],
                      ["structure", t("database.tab.structure")],
                      ["query", t("database.tab.query")],
                    ] as const
                  ).map(([key, label]) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => {
                        setTab(key);
                        if (key === "structure" && table) void loadStructure(table);
                      }}
                      className={`-mb-px border-b-2 px-3 py-2 text-sm transition-colors ${
                        tab === key
                          ? "border-brand font-medium text-brand"
                          : "border-transparent text-subtle hover:text-ink"
                      }`}
                    >
                      {label}
                    </button>
                  ))}

                  {result && (
                    <div className="ml-auto flex items-center gap-2 pb-1 text-xs">
                      <button
                        type="button"
                        onClick={() => exportResult("csv")}
                        className="flex items-center gap-1 text-brand hover:underline"
                      >
                        <Download className="size-3.5" /> CSV
                      </button>
                      <button
                        type="button"
                        onClick={() => exportResult("json")}
                        className="flex items-center gap-1 text-brand hover:underline"
                      >
                        <Download className="size-3.5" /> JSON
                      </button>
                    </div>
                  )}
                </div>

                {tab === "query" && (
                  <div className="space-y-2">
                    <textarea
                      value={sql}
                      onChange={(e) => setSql(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) void execute();
                      }}
                      spellCheck={false}
                      rows={8}
                      placeholder={active.engine === "redis" ? t("database.redisPlaceholder") : "SELECT * FROM ..."}
                      className="w-full rounded-md border border-line bg-canvas p-3 font-mono text-xs outline-none focus:border-brand"
                    />
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void execute()}
                        className="flex items-center gap-1.5 rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
                      >
                        <Play className="size-4" /> {t("database.run")}
                      </button>
                      <span className="text-xs text-subtle">Ctrl+Enter</span>
                      <button
                        type="button"
                        disabled={!sql.trim()}
                        onClick={() => {
                          const name = prompt(t("database.queryName"));
                          if (name?.trim()) {
                            void manage({
                              action: "save-query",
                              connectionId: active.id,
                              name: name.trim(),
                              sql,
                            });
                          }
                        }}
                        className="flex items-center gap-1.5 rounded-md border border-line px-3 py-1.5 text-sm transition-colors hover:border-brand disabled:opacity-50"
                      >
                        <Star className="size-4" /> {t("common.actions.save")}
                      </button>

                      {data.saved.length > 0 && (
                        <select
                          value=""
                          onChange={(e) => {
                            const found = data.saved.find((entry) => entry.id === Number(e.target.value));
                            if (found) setSql(found.sql);
                          }}
                          className="rounded-md border border-line bg-canvas px-2 py-1.5 text-sm outline-none focus:border-brand"
                        >
                          <option value="">{t("database.savedQueries")}</option>
                          {data.saved.map((entry) => (
                            <option key={entry.id} value={entry.id}>
                              {entry.name}
                            </option>
                          ))}
                        </select>
                      )}
                    </div>
                  </div>
                )}

                {tab === "structure" && structure && (
                  <div className="space-y-3">
                    <ResultTable
                      columns={[
                        t("database.col.column"),
                        t("database.col.type"),
                        t("database.col.nullable"),
                        t("database.col.default"),
                        t("database.col.primaryKey"),
                      ]}
                      rows={structure.columns.map((column) => [
                        column.name,
                        column.type,
                        column.nullable ? t("database.yes") : t("database.no"),
                        column.defaultValue,
                        column.primaryKey ? "✓" : "",
                      ])}
                    />
                    {structure.indexes.length > 0 && (
                      <>
                        <h3 className="px-1 text-xs font-semibold text-subtle">{t("database.indexes")}</h3>
                        <ResultTable
                          columns={[t("users.roles.name"), t("database.col.columns"), t("database.col.unique")]}
                          rows={structure.indexes.map((index) => [
                            index.name,
                            index.columns.join(", "),
                            index.unique ? t("database.yes") : t("database.no"),
                          ])}
                        />
                      </>
                    )}
                    {structure.foreignKeys.length > 0 && (
                      <>
                        <h3 className="px-1 text-xs font-semibold text-subtle">{t("database.foreignKeys")}</h3>
                        <ResultTable
                          columns={[
                            t("database.col.column"),
                            t("database.col.targetTable"),
                            t("database.col.targetColumn"),
                          ]}
                          rows={structure.foreignKeys.map((fk) => [fk.column, fk.referencesTable, fk.referencesColumn])}
                        />
                      </>
                    )}
                    {structure.createSql && (
                      <pre className="overflow-x-auto rounded-md border border-line bg-canvas p-3 font-mono text-[11px]">
                        {structure.createSql}
                      </pre>
                    )}
                  </div>
                )}

                {(tab === "data" || tab === "query") && result && (
                  <>
                    <ResultTable columns={result.columns} rows={result.rows} />
                    <div className="flex items-center justify-between text-xs text-subtle">
                      <span>
                        {t("database.rows", { count: result.rowCount, ms: result.durationMs })}
                        {result.truncated && t("database.resultTruncated")}
                        {table?.rowCount !== null &&
                          table !== null &&
                          t("database.tableRows", { count: f.number(table.rowCount ?? 0) })}
                      </span>
                      {table && (
                        <div className="flex gap-2">
                          <button
                            type="button"
                            disabled={busy || offset === 0}
                            onClick={() => void openTable(table, Math.max(0, offset - PAGE))}
                            className="rounded-md border border-line px-3 py-1.5 disabled:opacity-40"
                          >
                            {t("database.previous")}
                          </button>
                          <button
                            type="button"
                            disabled={busy || result.rowCount < PAGE}
                            onClick={() => void openTable(table, offset + PAGE)}
                            className="rounded-md border border-line px-3 py-1.5 disabled:opacity-40"
                          >
                            {t("database.next")}
                          </button>
                        </div>
                      )}
                    </div>
                  </>
                )}

                {tab === "data" && !result && (
                  <p className="rounded-lg border border-dashed border-line bg-surface px-5 py-10 text-center text-sm text-subtle">
                    {t("database.pickTable")}
                  </p>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      <ConnectionModal
        key={`conn-${draft?.id ?? (draft ? "yeni" : "yok")}`}
        draft={draft}
        busy={busy}
        onClose={() => setDraft(null)}
        onSubmit={async (payload, isNew) => {
          if (await manage(payload, isNew ? "POST" : "PATCH")) setDraft(null);
        }}
      />

      <CredentialsModal
        key={`cred-${credentialsFor?.key ?? ""}`}
        instance={credentialsFor}
        onClose={() => setCredentialsFor(null)}
        onSaved={() => {
          setCredentialsFor(null);
          void loadInventory();
        }}
      />

      <CreateDbModal
        key={`create-${createFor?.key ?? ""}`}
        instance={createFor}
        onClose={() => setCreateFor(null)}
        onCreated={async (name) => {
          const instance = createFor;
          setCreateFor(null);
          setNotice(t("database.createDb.done", { name }));
          await loadInventory();
          if (instance) select({ connectionId: instance.connectionId, database: name });
        }}
      />

      <UsersModal key={`users-${usersFor?.key ?? ""}`} instance={usersFor} onClose={() => setUsersFor(null)} />

      <Modal open={showHistory} title={t("database.historyTitle")} onClose={() => setShowHistory(false)} wide>
        <p className="text-xs text-subtle">{t("database.historyIntro")}</p>
        <ul className="mt-3 divide-y divide-line rounded-md border border-line">
          {data.history.length === 0 && (
            <li className="px-3 py-6 text-center text-sm text-subtle">{t("database.historyEmpty")}</li>
          )}
          {data.history.map((entry) => (
            <li key={entry.id} className="px-3 py-2">
              <button
                type="button"
                onClick={() => {
                  setSql(entry.sql);
                  setTab("query");
                  setShowHistory(false);
                }}
                className="w-full text-left"
              >
                <code className="block truncate font-mono text-xs">{entry.sql}</code>
                <span className="text-[11px] text-subtle">
                  {f.dateTime(entry.ts * 1000)} · {entry.durationMs} ms ·{" "}
                  {entry.ok
                    ? t("database.historyRows", { count: entry.rowCount })
                    : t("database.historyError", { error: entry.error.slice(0, 80) })}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </Modal>
    </div>
  );
}

function ResultTable({
  columns,
  rows,
}: {
  columns: string[];
  rows: (string | number | boolean | null)[][];
}) {
  const t = useT();
  if (columns.length === 0) {
    return (
      <p className="rounded-lg border border-line bg-surface px-4 py-8 text-center text-sm text-subtle">
        {t("database.noResult")}
      </p>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-line bg-surface">
      <table className="w-full text-xs">
        <thead className="border-b border-line text-left text-subtle">
          <tr>
            {columns.map((column) => (
              <th key={column} className="whitespace-nowrap px-3 py-2 font-medium">
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line font-mono">
          {rows.map((row, index) => (
            <tr key={index} className="hover:bg-line/30">
              {row.map((value, columnIndex) => (
                <td
                  key={columnIndex}
                  className={`max-w-md truncate px-3 py-1 ${
                    value === null ? "italic text-subtle" : ""
                  }`}
                  title={value === null ? "NULL" : String(value)}
                >
                  {value === null ? "NULL" : String(value)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ConnectionModal({
  draft,
  busy,
  onClose,
  onSubmit,
}: {
  draft: (Partial<DbConnection> & { password?: string }) | null;
  busy: boolean;
  onClose: () => void;
  onSubmit: (payload: Record<string, unknown>, isNew: boolean) => void;
}) {
  const t = useT();
  const [form, setForm] = useState(draft);
  const isNew = !form?.id;
  const isSqlite = form?.engine === "sqlite";

  return (
    <Modal
      open={draft !== null}
      title={isNew ? t("database.modal.add") : t("database.modal.edit")}
      onClose={onClose}
    >
      {form && (
        <div className="space-y-3">
          <label className="block text-sm">
            <span className="text-subtle">{t("users.roles.name")}</span>
            <input
              value={form.name ?? ""}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className={inputClass}
            />
          </label>

          <label className="block text-sm">
            <span className="text-subtle">{t("database.modal.engine")}</span>
            <select
              value={form.engine ?? "sqlite"}
              onChange={(e) => {
                const engine = e.target.value as DbEngine;
                setForm({ ...form, engine, port: DEFAULT_PORT[engine] });
              }}
              className={inputClass}
            >
              {(Object.keys(ENGINE_LABEL) as DbEngine[]).map((engine) => (
                <option key={engine} value={engine}>
                  {ENGINE_LABEL[engine]}
                </option>
              ))}
            </select>
          </label>

          <label className="block text-sm">
            <span className="text-subtle">
              {isSqlite ? t("database.modal.filePath") : t("database.modal.serverAddress")}
            </span>
            <input
              value={form.host ?? ""}
              onChange={(e) => setForm({ ...form, host: e.target.value })}
              placeholder={
                isSqlite ? "/home/coraspirin/docker/pihole/etc-pihole/gravity.db" : "postgres"
              }
              className={`${inputClass} font-mono`}
            />
            {isSqlite && (
              <span className="mt-1 block text-xs text-subtle">
                {t("database.modal.sqliteHelp")}
              </span>
            )}
          </label>

          {!isSqlite && (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block text-sm">
                  <span className="text-subtle">{t("proxy.form.port")}</span>
                  <input
                    type="number"
                    value={form.port ?? 0}
                    onChange={(e) => setForm({ ...form, port: Number(e.target.value) })}
                    className={inputClass}
                  />
                </label>
                <label className="block text-sm">
                  <span className="text-subtle">{t("database.modal.database")}</span>
                  <input
                    value={form.database ?? ""}
                    onChange={(e) => setForm({ ...form, database: e.target.value })}
                    className={inputClass}
                  />
                </label>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block text-sm">
                  <span className="text-subtle">{t("database.modal.user")}</span>
                  <input
                    value={form.username ?? ""}
                    onChange={(e) => setForm({ ...form, username: e.target.value })}
                    className={inputClass}
                  />
                </label>
                <label className="block text-sm">
                  <span className="text-subtle">
                    {t("database.modal.password")} {isNew ? "" : t("database.modal.passwordKeep")}
                  </span>
                  <input
                    type="password"
                    autoComplete="off"
                    value={form.password ?? ""}
                    onChange={(e) => setForm({ ...form, password: e.target.value })}
                    className={inputClass}
                  />
                </label>
              </div>
            </>
          )}

          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.writable ?? false}
              onChange={(e) => setForm({ ...form, writable: e.target.checked })}
              className="mt-0.5 size-4 accent-[var(--brand)]"
            />
            <span>
              {t("database.modal.writable")}
              <span className="block text-xs text-subtle">
                <Rich
                  text={t("database.modal.writableHelp")}
                  values={{ perm: <code>db.write</code> }}
                />
              </span>
            </span>
          </label>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-line px-3 py-1.5 text-sm text-subtle transition-colors hover:text-ink"
            >
              {t("common.actions.cancel")}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => onSubmit({ ...form }, isNew)}
              className="rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {t("common.actions.save")}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
