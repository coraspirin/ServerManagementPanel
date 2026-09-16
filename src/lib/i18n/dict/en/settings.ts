import type { SettingsDict } from "../tr/settings.ts";
import { settingItems } from "./settings-items.ts";

export const settings: SettingsDict = {
  items: settingItems,

  sections: {
    collection: "Collection",
    retention: "Retention windows",
    charts: "Charts",
    thresholds: "Thresholds",
    metering: "Metering and display",
    restartLoop: "Restart-loop detection",
    actions: "Actions",
    autoprune: "Automatic disk cleanup",
    updates: "Updates",
    imageUpdates: "Image updates",
    terminal: "Terminal",
    scanning: "Scanning",
    speedtest: "Speed test",
    reverseProxy: "Reverse proxy",
    certificates: "Certificate tracking",
    ddns: "DDNS",
    weather: "Weather",
    internetIndicator: "Internet indicator",
    kiosk: "Kiosk",
    addressResolution: "Address resolution",
    serviceWidgets: "Service widgets",
    cardDiscovery: "Automatic card discovery",
    welcomePage: "Welcome page",
    temperature: "Temperature",
    diskHealth: "Disk health and RAID",
    capacityForecast: "Capacity forecast",
    notifyBehaviour: "Notification behaviour",
    quietHours: "Quiet hours",
    timeline: "Timeline",
    telegram: "Telegram",
    ha: "Home Assistant",
    ntfy: "ntfy",
    discord: "Discord",
    email: "Email",
    os: "Operating system",
    containerImages: "Container images",
    backupTracking: "Backup tracking",
    composeStacks: "Compose stacks",
    containerFiles: "Container files",
    hostCron: "Host cron",
    hostConsole: "Host console",
    dbAdmin: "Database manager",
    access: "Access",
    diskAnalysis: "Disk analysis",
    backupEngine: "Backup engine",
    storage: "Storage",
    vulnScan: "Vulnerability scan (M3.8)",
    portForward: "Port forward tracking (M3.8)",
    mqtt: "MQTT",
    prometheus: "Prometheus",
  },

  validation: {
    number: "Must be a number.",
    integer: "Must be a whole number.",
    min: "The smallest value is {value}.",
    max: "The largest value is {value}.",
    bool: "Must be true/false.",
    enum: "Must be one of the valid options.",
    cron: "Must be a 5-field cron expression (min hour day month weekday).",
    time: "Time must be in HH:MM format (e.g. 23:00).",
    owner: "Must be in uid:gid format (e.g. 1000:1000).",
    singleDir: "Must be a single folder path.",
    absolutePath: "Paths must be absolute (start with /).",
    text: "Must be text.",
    unknownKey: "Unknown setting: {key}",
  },

  groups: {
    general: { label: "General", description: "Language, theme, time zone" },
    monitoring: {
      label: "Monitoring & Retention",
      description: "Metric collection interval and per-tier retention windows (T1)",
    },
    health: {
      label: "Service Monitoring",
      description:
        "Health-check defaults — any monitor can override these by defining its own value",
    },
    alerts: {
      label: "Alert Thresholds",
      description: "Colour coding on the monitoring screen, and the notification trigger since M1.3",
    },
    docker: { label: "Docker", description: "Container metering and restart-loop detection" },
    hardware: {
      label: "Hardware",
      description: "Temperature, S.M.A.R.T and RAID/ZFS monitoring thresholds",
    },
    home: {
      label: "Home",
      description: "Weather location, internet indicator and kiosk view",
    },
    network: {
      label: "Network",
      description: "Network scanning, device inventory and Wake-on-LAN",
    },
    tailscale: {
      label: "Tailscale",
      description: "Tailnet status, peer list and node key expiry tracking",
    },
    proxy: {
      label: "Proxy & DDNS",
      description: "Domain publishing, certificate expiry tracking and dynamic DNS",
    },
    apps: {
      label: "Apps",
      description: "How card addresses resolve, and automatic card discovery from Docker labels",
    },
    notify: {
      label: "Notification Channels",
      description:
        "Each channel has its own level filter — send the critical ones to your phone and keep the rest in the panel",
    },
    updates: {
      label: "Updates & Backup",
      description:
        "The panel never INSTALLS an update, it only tells you — when to install is your call",
    },
    files: {
      label: "Files",
      description: "Roots the file manager may reach, and disk analysis limits",
    },
    logs: {
      label: "Logs",
      description: "Collecting, retaining and pruning container and journald logs",
    },
    security: { label: "Security", description: "Session lifetime and brute-force protection" },
    api: {
      label: "External API",
      description:
        "The bearer-token /api/v1 surface — for scripts, Grafana, mobile apps and n8n",
    },
    integration: {
      label: "External Integration",
      description:
        "MQTT publishing and Home Assistant discovery — your panel's data should not stay locked in the panel",
    },
    jobs: {
      label: "Panel Jobs",
      description: "How often background jobs run — changes take effect immediately",
    },
  },

  tabs: {
    label: "Setting categories",
  },

  screen: {
    searchPlaceholder: "Search within {group}…",
    elsewhere: "In other categories:",
    noMatch: "No setting in {group} matches “{query}”.",
    overridable: "overridable",
    overridableTitle: "Can be overridden per resource",
    restartRequired: "restart required",
    seeded: "seeded from env",
    seededTitle: "Seeded from an env variable at first install; the panel is authoritative now",
    unreadable:
      "A value is stored but cannot be read: MASTER_KEY differs from the one this value was saved with. You can put the old key back, or enter the value again.",
    saved: "saved",
    resetTitle: "Reset to default ({value})",
    containersEmpty: "None selected — every running container is collected.",
    notOverridable: "This setting cannot be overridden per resource.",
  },
};
