import type { MetricsDict } from "../tr/metrics.ts";

export const metrics: MetricsDict = {
  labels: {
    "cpu.pct": "CPU",
    "cpu.iowait_pct": "I/O wait",
    "mem.used_pct": "Memory",
    "mem.used": "Memory used",
    "mem.total": "Memory total",
    "swap.used_pct": "Swap",
    "swap.used": "Swap used",
    "load.1m": "Load (1 min)",
    "load.5m": "Load (5 min)",
    "load.15m": "Load (15 min)",
    "uptime.seconds": "Uptime",
    "disk.used_pct": "Disk usage",
    "disk.used": "Disk used",
    "disk.free": "Disk free",
    "disk.total": "Disk capacity",
    "net.rx_bps": "Download",
    "net.tx_bps": "Upload",
    "monitor.latency": "Response time",
    "docker.cpu_pct": "Container CPU",
    "docker.mem_used": "Container memory",
    "docker.mem_pct": "Container memory",
    "docker.net_rx": "Container network in",
    "docker.net_tx": "Container network out",
    "docker.blk_read": "Container disk read",
    "docker.blk_write": "Container disk write",
    "docker.restart_count": "Restarts",
    "docker.running": "Running",
  },

  ranges: {
    "1h": "1 hour",
    "6h": "6 hours",
    "24h": "24 hours",
    "7d": "7 days",
    "30d": "30 days",
    "1y": "1 year",
  },

  tiers: {
    raw: "raw",
    minute: "1-minute average",
    hour: "1-hour average",
    day: "daily average",
  },

  value: {
    seconds: "{value} s",
    milliseconds: "{value} ms",
  },

  legend: {
    total: "total",
  },

  screen: {
    empty:
      "No metrics collected yet. The collection job runs at the interval in settings; the cards will fill in within a few seconds.",
    cpu: "CPU",
    memory: "Memory",
    disk: "Disk",
    network: "Network",
    load: "System load",
    uptime: "Uptime",
    cores: "{count} cores",
    coresWithIo: "{count} cores · I/O wait {io}",
    diskFree: "{mount} · {free} free",
    netNote: "↓ download · ↑ {tx} upload",
    noInterfaces: "no interface found",
    loadNote: "5 min {load5} · 15 min {load15}",
    lastSample: "last sample {age} s ago",
    diskPartitions: "Disk partitions",
    loading: "loading…",
    resolution: "resolution: {tier}",
    chartCpu: "CPU",
    chartMemory: "Memory and swap",
    chartNetwork: "Network traffic",
    chartDisk: "Disk usage",
    chartLoad: "System load",
  },
};
