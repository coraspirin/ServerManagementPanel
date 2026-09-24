"use client";

import { createContext, useContext, useMemo } from "react";
import { installHostFetch, setClientHost } from "@/lib/client/host";

/** İstemciye giden sunucu özeti — sır ve bağlantı bilgisi taşımaz. */
export type HostSummary = {
  id: number;
  name: string;
  isLocal: boolean;
  status: "unknown" | "pending" | "online" | "offline" | "incompatible";
  latencyMs: number | null;
  color: string | null;
};

type HostContextValue = {
  hosts: HostSummary[];
  current: HostSummary;
  /** Birden fazla sunucu var mı — seçici ve sunucu adları yalnızca o zaman görünür. */
  multi: boolean;
};

const HostContext = createContext<HostContextValue | null>(null);

installHostFetch();

export function HostProvider({
  hosts,
  currentId,
  children,
}: {
  hosts: HostSummary[];
  currentId: number;
  children: React.ReactNode;
}) {
  const value = useMemo<HostContextValue>(() => {
    const current = hosts.find((host) => host.id === currentId) ?? hosts[0];
    return { hosts, current, multi: hosts.length > 1 };
  }, [hosts, currentId]);

  // Render sırasında: çocukların ilk efektlerindeki istekler de doğru başlığı
  // taşısın. Tek sunucuda başlık hiç eklenmez — istekler eskisiyle aynı.
  setClientHost(value.multi ? value.current.id : null);

  return <HostContext.Provider value={value}>{children}</HostContext.Provider>;
}

export function useHosts(): HostContextValue {
  const value = useContext(HostContext);
  if (!value) throw new Error("useHosts: HostProvider yok"); // i18n-ignore — geliştirici hatası
  return value;
}
