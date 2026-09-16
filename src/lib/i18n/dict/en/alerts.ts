import type { AlertsDict } from "../tr/alerts.ts";

export const alerts: AlertsDict = {
  cpu: {
    ok: "CPU load is back to normal",
    high: "CPU load is high ({value})",
    detail: "The last 5 minutes averaged {value}. Warning threshold {warn}, critical {crit}.",
  },

  ram: {
    ok: "Memory usage is back to normal",
    high: "Memory usage is high ({value})",
    detail: "Usage {value}{used}.",
  },

  disk: {
    ok: "{mount} usage is back to normal",
    high: "{mount} is filling up ({value})",
    detail: "{used} / {total} in use, {free} free.",
  },

  monitor: {
    down: "{name} is not responding",
    up: "{name} is working again",
    downDetail: "{target} — {error}",
    upDetail: "{target} — {latency} ms",
    noResponse: "no response",
  },

  temp: {
    ok: "{source} {label} temperature is back to normal",
    high: "{source} {label} is hot ({value} °C)",
    detail: "Reading {value} °C. Warning {warn} °C, critical {crit} °C{sensor}.",
    sensorOwn: " (the sensor's own thresholds)",
  },

  smart: {
    failed: "{device} reports a S.M.A.R.T failure",
    bad: "{device} is accumulating disk errors",
    ok: "{device} health is back to normal",
    detail: "{model} — status {health}. {counters}",
    reallocated: "reallocated sectors: {count}",
    pending: "pending sectors: {count}",
    uncorrectable: "uncorrectable: {count}",
  },

  pool: {
    degraded: "Pool {name} is degraded ({state})",
    scrubOverdue: "Pool {name} has not been verified for a long time",
    ok: "Pool {name} is back to normal",
    detail: "{kind} · status {state} · {detail}",
    lastScrub: " · last scrub {days} days ago",
  },

  report: {
    stale: "The hardware report is not being updated",
    ok: "The hardware report is being updated again",
    never: "scripts/hardware.sh on the host appears never to have run.",
    detail: "The last report was produced {minutes} minutes ago.",
  },

  capacity: {
    ok: "{label} is no longer trending towards full",
    filling: "{label} may be full in about {days} days",
    detail:
      "Currently {current}, rising {slope} points per day. Forecast based on {basedOn} days of data, fit {confidence}.",
  },

  restartLoop: {
    title: "{container} keeps restarting",
    detail:
      "It restarted {count} times in the last {minutes} minutes. Even though the container shows as “running” in the list it may not be serving; the logs are worth a look.",
  },

  osUpdate: {
    staleTitle: "The OS update report is stale",
    staleDetail:
      "os-updates.sh on the host has not run for more than {hours} hours. The list may be out of date — is the cron entry still there?",
    freshTitle: "The update report is current",
    freshDetail: "os-updates.sh is running on time.",
    securityLabel: "security updates",
    packageLabel: "package updates",
    pendingTitle: "{count} {label} pending",
    upToDateTitle: "The operating system is up to date",
    noneDetail: "No pending updates.",
    rebootSuffix: "\nThe server is waiting for a restart.",
  },

  backup: {
    unreadableTitle: "The backup folder cannot be read",
    noneTitle: "There is no backup in the backup folder",
    staleTitle: "The backup is stale",
    freshTitle: "Backups are current",
    emptyDetail: "{dir} is empty. Is the backup running?",
    detail: "Latest backup: {name} — {hours} hours ago (threshold {threshold} hours).",
  },

  imageUpdate: {
    available: "A new image version is available for {count} containers",
    upToDate: "All images are up to date",
    noneDetail: "The registry versions match the local ones.",
  },
};
