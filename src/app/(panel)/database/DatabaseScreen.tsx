"use client";

import { useCallback, useState } from "react";
import {
  AlertTriangle,
  Database,
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
import { CSRF_COOKIE, CSRF_HEADER } from "@/lib/auth/types";
import type { HistoryEntry, SavedQuery } from "@/lib/dbadmin/store";
import {
  DEFAULT_PORT,
  ENGINE_LABEL,
  type DbConnection,
  type DbEngine,
  type DbStructure,
  type DbTable,
  type QueryResult,
} from "@/lib/dbadmin/types";

/**
 * M3.6 — veritabanı yöneticisi.
 *
 * Ekranın en görünür mesajı yazma korumasıdır: her bağlantının başında bir kilit
 * simgesi var ve salt-okunur olan bağlantıda SQL editörü yazma denemesini
 * sunucuya bile göndermeden değil — gönderip net bir cevap alarak reddediyor
 * (kural tek yerde, istemcide kopyası yok).
 */

type Payload = {
  connections: DbConnection[];
  history: HistoryEntry[];
  saved: SavedQuery[];
};

function readCsrfToken(): string {
  const match = document.cookie.match(new RegExp(`(?:^|; )${CSRF_COOKIE}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : "";
}

const inputClass =
  "mt-1 w-full rounded-md border border-line bg-canvas px-3 py-1.5 text-sm outline-none focus:border-brand";

export function DatabaseScreen({
  initial,
  canWrite,
}: {
  initial: Payload;
  canWrite: boolean;
}) {
  const [data, setData] = useState(initial);
  const [active, setActive] = useState<DbConnection | null>(initial.connections[0] ?? null);
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
  const [discovery, setDiscovery] = useState<
    { container: string; engine: DbEngine; alreadyKnown: boolean }[] | null
  >(null);
  const [showHistory, setShowHistory] = useState(false);

  const PAGE = 100;

  async function call(path: string, method: string, body?: unknown) {
    const response = await fetch(path, {
      method,
      headers: { "content-type": "application/json", [CSRF_HEADER]: readCsrfToken() },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { response, payload: (await response.json()) as Record<string, unknown> };
  }

  const loadTables = useCallback(async (connection: DbConnection) => {
    setBusy(true);
    setError(null);
    setTables([]);
    setTable(null);
    setResult(null);
    try {
      const { response, payload } = await call(
        `/api/database?mode=tables&id=${connection.id}`,
        "GET",
      );
      if (!response.ok) {
        setError(String(payload.error ?? "Tablolar okunamadı."));
        return;
      }
      setTables((payload.tables as DbTable[]) ?? []);
    } finally {
      setBusy(false);
    }
  }, []);

  async function selectConnection(connection: DbConnection) {
    setActive(connection);
    setTab("data");
    await loadTables(connection);
  }

  async function openTable(entry: DbTable, nextOffset = 0) {
    if (!active) return;
    setBusy(true);
    setError(null);
    setTable(entry);
    setTab("data");
    try {
      const { response, payload } = await call("/api/database/query", "POST", {
        connectionId: active.id,
        mode: "table",
        schema: entry.schema,
        table: entry.name,
        limit: PAGE,
        offset: nextOffset,
      });
      if (!response.ok) {
        setError(String(payload.error ?? "Tablo okunamadı."));
        return;
      }
      setResult(payload.result as QueryResult);
      setOffset(nextOffset);
    } finally {
      setBusy(false);
    }
  }

  async function loadStructure(entry: DbTable) {
    if (!active) return;
    setBusy(true);
    setTab("structure");
    setTable(entry);
    try {
      const { response, payload } = await call(
        `/api/database?mode=structure&id=${active.id}&schema=${encodeURIComponent(
          entry.schema,
        )}&table=${encodeURIComponent(entry.name)}`,
        "GET",
      );
      if (!response.ok) {
        setError(String(payload.error ?? "Yapı okunamadı."));
        return;
      }
      setStructure(payload.structure as DbStructure);
    } finally {
      setBusy(false);
    }
  }

  async function execute(confirmed = false) {
    if (!active) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    setPendingConfirm(null);
    try {
      const { response, payload } = await call("/api/database/query", "POST", {
        connectionId: active.id,
        sql,
        confirmed,
      });

      if (response.status === 409) {
        setPendingConfirm({ dangers: (payload.dangers as string[]) ?? [] });
        return;
      }
      if (!response.ok) {
        setError(String(payload.error ?? "Sorgu başarısız."));
        return;
      }

      const outcome = payload.result as QueryResult;
      setResult(outcome);
      setTable(null);
      setNotice(
        outcome.affected !== null
          ? `${outcome.affected} satır etkilendi · ${outcome.durationMs} ms`
          : `${outcome.rowCount} satır · ${outcome.durationMs} ms${
              outcome.truncated ? " (kesildi)" : ""
            }`,
      );
      if (payload.history) setData({ ...data, history: payload.history as HistoryEntry[] });
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
        setData((prev) => ({ ...prev, connections: payload.connections as DbConnection[] }));
      }
      if (payload.saved) {
        setData((prev) => ({ ...prev, saved: payload.saved as SavedQuery[] }));
      }
      if (!response.ok) {
        setError(String(payload.error ?? "İşlem başarısız."));
        return false;
      }
      if (payload.message) setNotice(String(payload.message));
      return true;
    } finally {
      setBusy(false);
    }
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
    link.download = `sorgu-sonucu.${format}`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-4">
      <section className="flex flex-wrap items-center gap-2 rounded-lg border border-line bg-surface p-3">
        <Database className="size-4 text-subtle" aria-hidden />
        <select
          value={active?.id ?? 0}
          onChange={(e) => {
            const found = data.connections.find((entry) => entry.id === Number(e.target.value));
            if (found) void selectConnection(found);
          }}
          className="rounded-md border border-line bg-canvas px-2 py-1.5 text-sm outline-none focus:border-brand"
        >
          {data.connections.length === 0 && <option value={0}>Bağlantı yok</option>}
          {data.connections.map((connection) => (
            <option key={connection.id} value={connection.id}>
              {connection.name} — {ENGINE_LABEL[connection.engine]}
            </option>
          ))}
        </select>

        {active && (
          <span
            className={`flex items-center gap-1 rounded px-2 py-1 text-xs font-medium ${
              active.writable ? "bg-warn/15 text-warn" : "bg-ok/10 text-ok"
            }`}
            title={
              active.writable
                ? "Bu bağlantı yazma işlemlerine açık"
                : "Bu bağlantıdan yalnızca okunabilir"
            }
          >
            {active.writable ? <Unlock className="size-3" /> : <Lock className="size-3" />}
            {active.writable ? "yazılabilir" : "salt-okunur"}
          </span>
        )}

        {active && !active.passwordReadable && (
          <span className="flex items-center gap-1 rounded bg-danger/10 px-2 py-1 text-xs text-danger">
            <AlertTriangle className="size-3" /> parola çözülemiyor
          </span>
        )}

        <div className="ml-auto flex flex-wrap gap-2">
          {active && (
            <>
              <button
                type="button"
                disabled={busy}
                onClick={() => void manage({ action: "test", id: active.id })}
                className="rounded-md border border-line px-2.5 py-1.5 text-xs transition-colors hover:border-brand disabled:opacity-50"
              >
                Bağlantıyı sına
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void loadTables(active)}
                title="Tabloları yenile"
                className="rounded-md border border-line p-1.5 text-subtle transition-colors hover:text-ink disabled:opacity-50"
              >
                <RefreshCw className={`size-3.5 ${busy ? "animate-spin" : ""}`} />
              </button>
              {canWrite && (
                <>
                  <button
                    type="button"
                    onClick={() => setDraft({ ...active, password: "" })}
                    className="rounded-md border border-line px-2.5 py-1.5 text-xs transition-colors hover:border-brand"
                  >
                    Düzenle
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    title="Bağlantıyı sil"
                    onClick={async () => {
                      if (
                        confirm(
                          `"${active.name}" bağlantısı silinsin mi? Veritabanının kendisine dokunulmaz.`,
                        )
                      ) {
                        const { response, payload } = await call(
                          `/api/database?id=${active.id}`,
                          "DELETE",
                        );
                        if (response.ok) {
                          const next = (payload.connections as DbConnection[]) ?? [];
                          setData((prev) => ({ ...prev, connections: next }));
                          setActive(next[0] ?? null);
                          setTables([]);
                          setTable(null);
                          setResult(null);
                        } else {
                          setError(String(payload.error ?? "Silinemedi."));
                        }
                      }
                    }}
                    className="rounded border border-line p-1.5 text-subtle transition-colors hover:text-danger disabled:opacity-50"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </>
              )}
            </>
          )}
          <button
            type="button"
            onClick={() => setShowHistory(true)}
            className="flex items-center gap-1.5 rounded-md border border-line px-2.5 py-1.5 text-xs transition-colors hover:border-brand"
          >
            <History className="size-3.5" /> Geçmiş
          </button>
          {canWrite && (
            <>
              <button
                type="button"
                disabled={busy}
                onClick={async () => {
                  const { payload } = await call("/api/database?mode=discover", "GET");
                  setDiscovery(
                    (payload.discovered as { container: string; engine: DbEngine; alreadyKnown: boolean }[]) ??
                      [],
                  );
                }}
                className="rounded-md border border-line px-2.5 py-1.5 text-xs transition-colors hover:border-brand disabled:opacity-50"
              >
                Container&apos;lardan keşfet
              </button>
              <button
                type="button"
                onClick={() =>
                  setDraft({ engine: "sqlite", name: "", host: "", port: 0, writable: false })
                }
                className="flex items-center gap-1.5 rounded-md bg-brand px-2.5 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90"
              >
                <Plus className="size-3.5" /> Bağlantı
              </button>
            </>
          )}
        </div>
      </section>

      {error && (
        <p role="alert" className="rounded-lg bg-danger/10 px-4 py-2.5 text-sm text-danger">
          {error}
        </p>
      )}
      {notice && <p className="rounded-lg bg-ok/10 px-4 py-2.5 text-sm text-ok">{notice}</p>}

      {pendingConfirm && (
        <div className="rounded-lg border border-danger/50 bg-danger/5 p-4">
          <p className="flex items-center gap-2 text-sm font-medium text-danger">
            <AlertTriangle className="size-4" aria-hidden /> Bu sorgu ek onay istiyor
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
              Vazgeç
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void execute(true)}
              className="rounded-md bg-danger px-3 py-1.5 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              Anladım, çalıştır
            </button>
          </div>
        </div>
      )}

      {data.connections.length === 0 ? (
        <div className="rounded-lg border border-dashed border-line bg-surface px-5 py-12 text-center">
          <Database className="mx-auto size-8 text-subtle" aria-hidden />
          <p className="mt-3 text-sm">Henüz bağlantı yok.</p>
          <p className="mt-1 text-xs text-subtle">
            Container&apos;lardan keşfet ya da elle bir bağlantı ekle. SQLite için host
            üzerindeki dosya yolunu vermen yeterli.
          </p>
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[16rem_1fr]">
          <aside className="rounded-lg border border-line bg-surface">
            <div className="border-b border-line px-3 py-2 text-xs font-semibold text-subtle">
              Tablolar {tables.length > 0 && `(${tables.length})`}
            </div>
            <ul className="max-h-[32rem] divide-y divide-line overflow-y-auto">
              {tables.length === 0 && (
                <li className="px-3 py-6 text-center text-xs text-subtle">
                  {busy ? "Okunuyor…" : "Tablo yok."}
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
                      {entry.schema !== "main" && entry.schema !== "keyspace" && (
                        <span className="text-subtle">{entry.schema}.</span>
                      )}
                      {entry.name}
                    </span>
                    <span className="shrink-0 tabular-nums text-subtle">
                      {entry.rowCount === null ? "?" : entry.rowCount.toLocaleString("tr-TR")}
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
                  ["data", "Veri"],
                  ["structure", "Yapı"],
                  ["query", "SQL"],
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
                  placeholder="SELECT * FROM ..."
                  className="w-full rounded-md border border-line bg-canvas p-3 font-mono text-xs outline-none focus:border-brand"
                />
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    disabled={busy || !active}
                    onClick={() => void execute()}
                    className="flex items-center gap-1.5 rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
                  >
                    <Play className="size-4" /> Çalıştır
                  </button>
                  <span className="text-xs text-subtle">Ctrl+Enter</span>
                  <button
                    type="button"
                    disabled={!sql.trim()}
                    onClick={() => {
                      const name = prompt("Sorgu adı:");
                      if (name?.trim()) {
                        void manage({
                          action: "save-query",
                          connectionId: active?.id ?? null,
                          name: name.trim(),
                          sql,
                        });
                      }
                    }}
                    className="flex items-center gap-1.5 rounded-md border border-line px-3 py-1.5 text-sm transition-colors hover:border-brand disabled:opacity-50"
                  >
                    <Star className="size-4" /> Kaydet
                  </button>

                  {data.saved.length > 0 && (
                    <select
                      value=""
                      onChange={(e) => {
                        const found = data.saved.find(
                          (entry) => entry.id === Number(e.target.value),
                        );
                        if (found) setSql(found.sql);
                      }}
                      className="rounded-md border border-line bg-canvas px-2 py-1.5 text-sm outline-none focus:border-brand"
                    >
                      <option value="">Kayıtlı sorgular…</option>
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
                  columns={["Sütun", "Tip", "Boş olabilir", "Varsayılan", "Birincil anahtar"]}
                  rows={structure.columns.map((column) => [
                    column.name,
                    column.type,
                    column.nullable ? "evet" : "hayır",
                    column.defaultValue,
                    column.primaryKey ? "✓" : "",
                  ])}
                />
                {structure.indexes.length > 0 && (
                  <>
                    <h3 className="px-1 text-xs font-semibold text-subtle">İndeksler</h3>
                    <ResultTable
                      columns={["Ad", "Sütunlar", "Benzersiz"]}
                      rows={structure.indexes.map((index) => [
                        index.name,
                        index.columns.join(", "),
                        index.unique ? "evet" : "hayır",
                      ])}
                    />
                  </>
                )}
                {structure.foreignKeys.length > 0 && (
                  <>
                    <h3 className="px-1 text-xs font-semibold text-subtle">Yabancı anahtarlar</h3>
                    <ResultTable
                      columns={["Sütun", "Hedef tablo", "Hedef sütun"]}
                      rows={structure.foreignKeys.map((fk) => [
                        fk.column,
                        fk.referencesTable,
                        fk.referencesColumn,
                      ])}
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
                    {result.rowCount} satır · {result.durationMs} ms
                    {result.truncated && " · sonuç kesildi"}
                    {table?.rowCount !== null &&
                      table !== null &&
                      ` · tabloda ${table.rowCount?.toLocaleString("tr-TR")} satır`}
                  </span>
                  {table && (
                    <div className="flex gap-2">
                      <button
                        type="button"
                        disabled={busy || offset === 0}
                        onClick={() => void openTable(table, Math.max(0, offset - PAGE))}
                        className="rounded-md border border-line px-3 py-1.5 disabled:opacity-40"
                      >
                        Önceki
                      </button>
                      <button
                        type="button"
                        disabled={busy || result.rowCount < PAGE}
                        onClick={() => void openTable(table, offset + PAGE)}
                        className="rounded-md border border-line px-3 py-1.5 disabled:opacity-40"
                      >
                        Sonraki
                      </button>
                    </div>
                  )}
                </div>
              </>
            )}

            {tab === "data" && !result && (
              <p className="rounded-lg border border-dashed border-line bg-surface px-5 py-10 text-center text-sm text-subtle">
                Soldan bir tablo seç.
              </p>
            )}
          </div>
        </div>
      )}

      <ConnectionModal
        key={`conn-${draft?.id ?? (draft ? "yeni" : "yok")}`}
        draft={draft}
        busy={busy}
        onClose={() => setDraft(null)}
        onSubmit={async (payload, isNew) => {
          if (await manage(payload, isNew ? "POST" : "PATCH")) setDraft(null);
        }}
      />

      <Modal
        open={discovery !== null}
        title="Container'lardan keşfedilen veritabanları"
        onClose={() => setDiscovery(null)}
      >
        <p className="text-xs text-subtle">
          Motor imaj adından tanınır, kullanıcı adı ve parola container&apos;ın ortam
          değişkenlerinden önerilir. Eklenen bağlantı <strong>salt-okunur</strong> başlar.
        </p>
        <ul className="mt-3 divide-y divide-line rounded-md border border-line">
          {(discovery ?? []).length === 0 && (
            <li className="px-3 py-6 text-center text-sm text-subtle">
              Tanınan bir veritabanı container&apos;ı bulunamadı.
            </li>
          )}
          {(discovery ?? []).map((entry) => (
            <li key={entry.container} className="flex items-center gap-3 px-3 py-2 text-sm">
              <span className="flex-1">
                {entry.container}
                <span className="ml-2 text-xs text-subtle">{ENGINE_LABEL[entry.engine]}</span>
              </span>
              {entry.alreadyKnown ? (
                <span className="text-xs text-subtle">zaten ekli</span>
              ) : (
                <button
                  type="button"
                  disabled={busy}
                  onClick={async () => {
                    if (await manage({ action: "import", container: entry.container })) {
                      setDiscovery(null);
                    }
                  }}
                  className="rounded-md border border-line px-2.5 py-1 text-xs transition-colors hover:border-brand disabled:opacity-50"
                >
                  Ekle
                </button>
              )}
            </li>
          ))}
        </ul>
      </Modal>

      <Modal open={showHistory} title="Sorgu geçmişim" onClose={() => setShowHistory(false)} wide>
        <p className="text-xs text-subtle">
          Geçmiş kullanıcı bazında tutulur — başkasının sorguları (ve içindeki veri) burada
          görünmez.
        </p>
        <ul className="mt-3 divide-y divide-line rounded-md border border-line">
          {data.history.length === 0 && (
            <li className="px-3 py-6 text-center text-sm text-subtle">Henüz sorgu yok.</li>
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
                  {new Date(entry.ts * 1000).toLocaleString("tr-TR")} · {entry.durationMs} ms ·{" "}
                  {entry.ok ? `${entry.rowCount} satır` : `hata: ${entry.error.slice(0, 80)}`}
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
  if (columns.length === 0) {
    return (
      <p className="rounded-lg border border-line bg-surface px-4 py-8 text-center text-sm text-subtle">
        Sonuç satırı yok.
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
  const [form, setForm] = useState(draft);
  const isNew = !form?.id;
  const isSqlite = form?.engine === "sqlite";

  return (
    <Modal
      open={draft !== null}
      title={isNew ? "Veritabanı bağlantısı ekle" : "Bağlantıyı düzenle"}
      onClose={onClose}
    >
      {form && (
        <div className="space-y-3">
          <label className="block text-sm">
            <span className="text-subtle">Ad</span>
            <input
              value={form.name ?? ""}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className={inputClass}
            />
          </label>

          <label className="block text-sm">
            <span className="text-subtle">Motor</span>
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
              {isSqlite ? "Host üzerindeki dosya yolu" : "Sunucu adresi"}
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
                Container içindeki yol değil, HOST üzerindeki yol. Panel dosyayı okuyamazsa
                sorgu geçici bir container üzerinden çalıştırılır — dosya kopyalanmaz.
              </span>
            )}
          </label>

          {!isSqlite && (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block text-sm">
                  <span className="text-subtle">Port</span>
                  <input
                    type="number"
                    value={form.port ?? 0}
                    onChange={(e) => setForm({ ...form, port: Number(e.target.value) })}
                    className={inputClass}
                  />
                </label>
                <label className="block text-sm">
                  <span className="text-subtle">Veritabanı</span>
                  <input
                    value={form.database ?? ""}
                    onChange={(e) => setForm({ ...form, database: e.target.value })}
                    className={inputClass}
                  />
                </label>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block text-sm">
                  <span className="text-subtle">Kullanıcı</span>
                  <input
                    value={form.username ?? ""}
                    onChange={(e) => setForm({ ...form, username: e.target.value })}
                    className={inputClass}
                  />
                </label>
                <label className="block text-sm">
                  <span className="text-subtle">
                    Parola {isNew ? "" : "(boş = değişmesin)"}
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
              Yazma işlemlerine açık
              <span className="block text-xs text-subtle">
                Kapalıyken bu bağlantıdan INSERT/UPDATE/DELETE/DROP çalıştırılamaz —{" "}
                <code>db.write</code> izni olsa bile. İki ayrı kapı, çünkü yanlış pencerede
                çalıştırılan bir UPDATE geri alınamaz.
              </span>
            </span>
          </label>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-line px-3 py-1.5 text-sm text-subtle transition-colors hover:text-ink"
            >
              Vazgeç
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => onSubmit({ ...form }, isNew)}
              className="rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              Kaydet
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
