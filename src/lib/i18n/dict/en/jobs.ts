import type { JobsDict } from "../tr/jobs.ts";

export const jobs: JobsDict = {
  items: {
    "metrics.collect": {
      label: "Metric collection",
      description: "Records CPU, memory, disk and network samples.",
    },
    "metrics.rollup": {
      label: "Metric rollup & pruning",
      description: "Rolls raw metrics into minute/hour/day tiers and deletes what has expired.",
    },
    "docker.collect": {
      label: "Container metering",
      description: "Records container CPU/memory usage and the restart counter.",
    },
    "docker.autoprune": {
      label: "Docker automatic cleanup",
      description: "Deletes unused Docker resources within the scope chosen in settings.",
    },
    "monitors.check": {
      label: "Service check",
      description: "Polls monitors that are due and records status changes.",
    },
    "alerts.evaluate": {
      label: "Alert evaluation",
      description: "Checks thresholds and service states, and sends the notifications needed.",
    },
    "updates.images": {
      label: "Image update check",
      description: "Compares the registry version of container images against the local one.",
    },
    "apps.discover": {
      label: "Card discovery",
      description:
        "Creates and updates app cards from Docker labels, and removes ones whose label is gone.",
    },
    "network.scan": {
      label: "Network scan",
      description: "Probes devices on the subnet, updates the inventory and reports new devices.",
    },
    "network.oui": {
      label: "Vendor list update",
      description: "Refreshes the IEEE list used to turn MAC addresses into vendor names.",
    },
    "network.speedtest": {
      label: "Speed test",
      description: "Measures the internet connection's download/upload speed and records history.",
    },
    "proxy.certificates": {
      label: "Certificate check",
      description:
        "Reads the certificate expiry dates of published domains and reports the ones coming up.",
    },
    "proxy.ddns": {
      label: "DDNS update",
      description: "Updates dynamic DNS records when the home IP changes.",
    },
    "tailscale.keys": {
      label: "Tailscale key check",
      description: "Reports devices whose node key expires soon.",
    },
    "events.prune": {
      label: "Event log pruning",
      description: "Deletes event records past the retention period.",
    },
    "uptime.prune": {
      label: "Uptime pruning",
      description: "Deletes service status records past the retention period.",
    },
    "sessions.prune": {
      label: "Session cleanup",
      description: "Deletes expired session records.",
    },
    "api.tokens_prune": {
      label: "API key pruning",
      description: "Deletes keys whose retention period has passed since revocation or expiry.",
    },
    "security.vuln_scan": {
      label: "Vulnerability scan",
      description: "Scans running container images with Trivy (M3.8).",
    },
    "security.upnp_scan": {
      label: "Port forward check",
      description: "Reads UPnP forwards on the router and reports new ones (M3.8).",
    },
    "security.port_scan": {
      label: "Port map scan",
      description: "Scans listening ports and their owners, and caches the result (M3.17).",
    },
    "backup.scheduler": {
      label: "Backup scheduler",
      description: "Runs backup jobs that are due (M3.4).",
    },
    "logs.collect": {
      label: "Log collection",
      description: "Writes container and journald logs into the search index (M3.3).",
    },
    "logs.prune": {
      label: "Log pruning",
      description: "Deletes log lines past the retention period and the line ceiling.",
    },
    "mqtt.publish": {
      label: "MQTT publishing",
      description: "Publishes panel metrics to the MQTT broker (M3.11).",
    },
    "audit.prune": {
      label: "Audit pruning",
      description: "Deletes audit records past the retention period.",
    },
  },

  schedule: {
    monitors: "continuous (polled every 10 s)",
    alerts: "continuous (every 30 s)",
  },

  status: {
    success: "succeeded",
    error: "failed",
    running: "running",
    waiting: "waiting",
  },

  detail: {
    samples: "{count} samples",
    dockerCollect: "{running}/{containers} running · {written} measurements",
    autopruneOff: "automatic cleanup off",
    pruned: "{scope}: {removed} resources, {mb} MB",
    noMonitorsDue: "no monitor due",
    monitors: "{checked} checks",
    monitorsChanged: "{checked} checks · changed → {summary}",
    maintenance: "maintenance",
    alertsNoChange: "{evaluated} conditions · no change",
    alerts: "{evaluated} conditions · {events} events · {notified} notifications",
    alertsSuppressed: " · suppressed {list}",
    images: "{count} containers · {outdated} with updates",
    imagesUnknown: " · {count} could not be checked",
    discoveryOff: "automatic discovery off",
    scanOff: "automatic scan off",
    noSubnet: "could not determine the subnet",
    scan: "{subnet} · {scanned} addresses · {alive} devices",
    scanNew: " · {count} new",
    speedtestOff: "automatic speed test off",
    speedtest: "{down} Mbit down · {up} Mbit up · {ping} ms",
    noDomains: "no published domain",
    certs: "{count} domains",
    certsExpiring: " · {count} expiring",
    certsUnreadable: " · {count} unreadable",
    ddnsUpdated: "{count} updated",
    ddnsUnchanged: "{count} unchanged",
    ddnsFailed: "{count} failed",
    ddnsNone: "no records",
    tailscaleUnavailable: "tailscaled unreachable",
    tailscaleNodes: "{count} nodes",
    tailscaleExpiring: " · {count} keys expiring",
    eventsPruned: "{count} events pruned",
    uptimePruned: "{count} records pruned",
    sessionsPruned: "{count} sessions cleaned",
    sessionsChallenges: ", {count} half-finished sign-ins",
    tokensPruned: "{count} keys pruned",
    vulnPruned: " · {count} old records pruned",
    sockets: "{count} sockets",
    logs: "{lines} lines / {sources} sources",
    logsMatched: "{count} patterns matched",
    logsSkipped: "skipped: {list}",
    logsErrors: "error: {list}",
    logsPrunedAge: "{count} lines by age",
    logsPrunedSize: ", {count} lines by ceiling",
    mqttOff: "MQTT off",
    mqtt: "{count} topics published",
    mqttDiscovery: " · {count} HA sensors announced",
    auditPruned: "{count} records pruned (older than {months} months)",
  },

  announce: {
    newDeviceTitle: "New device on the network",
    newDeviceHint: "If you recognise the device you can mark it on the Network screen.",
    certTitle: "Certificate expiring: {domain}",
    certExpired: "The certificate for {domain} expired {days} days ago.",
    certExpiring: "The certificate for {domain} expires in {days} days.",
    ipChangedTitle: "Public IP changed",
    tailscaleTitle: "Tailscale key expiring: {host}",
    tailscaleExpired: "{host}'s key has expired; the device may have dropped off the tailnet.",
    tailscaleExpiring:
      "{host}'s node key expires in {days} days. A device whose key expires drops off the tailnet silently.",
  },

  runner: {
    unknownJob: "unknown job",
    alreadyRunning: "job already running",
  },

  screen: {
    intro:
      "Schedules are changed under {settings}; changes take effect immediately, with no restart.",
    introSettings: "Settings → Panel Jobs",
    colJob: "Job",
    colSchedule: "Frequency",
    colStatus: "Status",
    colLastRun: "Last run",
    colNext: "Next",
    colRuns: "Runs/Failures",
    runNow: "Run now",
    everySeconds: "every {value} s",
    inSeconds: "in {value}",
    agoSeconds: "{value} ago",
  },
};
