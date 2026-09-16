/**
 * Shared strings — ENGLISH.
 *
 * The type comes from the Turkish file, which is the source of truth: a
 * missing or misspelled key fails `npm run typecheck` instead of silently
 * showing the raw key on screen.
 */

import type { CommonDict } from "../tr/common.ts";

export const common: CommonDict = {
  appName: "Server Management Panel",
  appDescription: "Monitoring, Docker/system management and automation panel for a home server",

  uncategorized: "Other",

  duration: {
    day: { one: "{count} day", other: "{count} days" },
    hour: { one: "{count} hour", other: "{count} hours" },
    minute: { one: "{count} min", other: "{count} min" },
    second: { one: "{count} sec", other: "{count} sec" },
  },

  durationShort: {
    day: { one: "{count}d", other: "{count}d" },
    hour: { one: "{count}h", other: "{count}h" },
    minute: { one: "{count}m", other: "{count}m" },
    second: { one: "{count}s", other: "{count}s" },
  },

  relative: {
    now: "just now",
    minutes: { one: "{count} min ago", other: "{count} min ago" },
    hours: { one: "{count}h ago", other: "{count}h ago" },
    days: { one: "{count} day ago", other: "{count} days ago" },
  },

  actions: {
    save: "Save",
    cancel: "Cancel",
    delete: "Delete",
    edit: "Edit",
    add: "Add",
    close: "Close",
    refresh: "Refresh",
    retry: "Retry",
    confirm: "Confirm",
    search: "Search",
    copy: "Copy",
    copied: "Copied",
    details: "Details",
    back: "Back",
  },

  states: {
    loading: "Loading…",
    saving: "Saving…",
    saved: "Saved",
    empty: "No records",
    none: "None",
    unknown: "Unknown",
    yes: "Yes",
    no: "No",
    on: "On",
    off: "Off",
  },

  errors: {
    generic: "Something went wrong.",
    network: "Could not reach the server.",
    notSaved: "Could not be saved.",
  },
};
