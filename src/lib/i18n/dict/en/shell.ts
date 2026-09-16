import type { ShellDict } from "../tr/shell.ts";

export const shell: ShellDict = {
  brand: "Server Panel",

  menu: {
    open: "Open menu",
    close: "Close menu",
  },

  mode: {
    mock: "MOCK",
    live: "LIVE",
    mockTitle: "MOCK_MODE is on — data comes from fixtures/",
    liveTitle: "Using real data sources",
  },

  search: {
    title: "Search and go (Ctrl+K)",
    label: "Search and go",
  },

  account: {
    title: "My account — password and two-factor authentication",
  },

  logout: "Log out",

  theme: {
    title: "Switch between light and dark theme",
    label: "Change theme",
  },

  help: {
    button: "What is this page for?",
    how: "How it works",
    caution: "Caution",
  },

  palette: {
    label: "Command palette",
    placeholder: "Search pages, containers, apps or services…",
    empty: "No matches.",
    emptyLoading: "No matches (live records still loading…).",
    kind: {
      page: "Page",
      container: "Container",
      app: "App",
      monitor: "Service",
    },
  },
};
