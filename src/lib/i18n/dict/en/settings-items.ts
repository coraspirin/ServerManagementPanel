import type { SettingItemsDict } from "../tr/settings-items.ts";

export const settingItems: SettingItemsDict = {
  "general.language": {
    label: "Language",
    help: "The panel's interface language. Changing it reloads the page; the setting is shared by all users.",
    options: {
      "tr": "Türkçe",
      "en": "English",
    },
  },
  "general.theme": {
    label: "Theme",
    options: {
      "system": "System",
      "light": "Light",
      "dark": "Dark",
    },
  },
  "general.timezone": {
    label: "Time zone",
    help: "Used when displaying timestamps.",
  },
  "general.ui_refresh_interval": {
    label: "Interface refresh interval",
    help: "How often live cards refresh themselves.",
    unit: "sec",
  },
  "monitoring.collect_interval": {
    label: "Metric collection interval",
    help: "The resolution of raw metrics. Increasing it lowers the load on the database.",
    unit: "sec",
  },
  "monitoring.retention.raw_hours": {
    label: "Raw metric retention",
    help: "Raw samples older than this are pruned (rollups are kept).",
    unit: "hours",
  },
  "monitoring.retention.minute_days": {
    label: "1-minute metric retention",
    unit: "days",
  },
  "monitoring.retention.hour_days": {
    label: "1-hour metric retention",
    unit: "days",
  },
  "monitoring.retention.day_months": {
    label: "Daily metric retention",
    help: "Determines how many months back monitoring reports can go.",
    unit: "months",
  },
  "monitoring.rollup_cron": {
    label: "Rollup/prune frequency",
    help: "How often the job that rolls raw data into tiers and prunes the old runs.",
  },
  "monitoring.disks": {
    label: "Disk partitions to monitor",
    help: "Comma-separated mount points (e.g. /, /mnt/data). If left empty, real file systems are found automatically.",
  },
  "monitoring.net_interfaces": {
    label: "Network interfaces to monitor",
    help: "Comma-separated interface names (e.g. enp3s0). If left empty, only physical interfaces are monitored; docker/veth bridges do not count.",
  },
  "monitoring.chart_default_range": {
    label: "Default chart range",
    options: {
      "1h": "Last 1 hour",
      "6h": "Last 6 hours",
      "24h": "Last 24 hours",
      "7d": "Last 7 days",
      "30d": "Last 30 days",
      "1y": "Last 1 year",
    },
  },
  "health.interval": {
    label: "Check interval",
    help: "Used when a monitor does not define its own interval.",
    unit: "sec",
  },
  "health.timeout": {
    label: "Timeout",
    unit: "sec",
  },
  "health.retries": {
    label: "Retries within one round",
    help: "Retried within the same round so a momentary network hiccup does not make a service look down.",
  },
  "health.down_threshold": {
    label: "Consecutive failures before 'offline'",
    help: "So a flapping service is not counted as offline on a single error (since M1.3 notifications depend on this too).",
  },
  "health.uptime_retention_months": {
    label: "Uptime history retention",
    unit: "months",
  },
  "alerts.cpu.warn": {
    label: "CPU — warning threshold",
    unit: "%",
  },
  "alerts.cpu.crit": {
    label: "CPU — critical threshold",
    unit: "%",
  },
  "alerts.ram.warn": {
    label: "Memory — warning threshold",
    unit: "%",
  },
  "alerts.ram.crit": {
    label: "Memory — critical threshold",
    unit: "%",
  },
  "alerts.disk.warn": {
    label: "Disk — warning threshold",
    help: "Will be overridable per disk later; for now it applies to every partition.",
    unit: "%",
  },
  "alerts.disk.crit": {
    label: "Disk — critical threshold",
    unit: "%",
  },
  "docker.stats_interval": {
    label: "Container metering interval",
    help: "Docker's /stats call takes about a second per container; metering too often keeps the server busy.",
    unit: "sec",
  },
  "docker.restart_loop.window": {
    label: "Restart-loop window",
    help: "Restarts within this period are counted.",
    unit: "min",
  },
  "docker.restart_loop.threshold": {
    label: "Restart-loop threshold",
    help: "Raises an alert if there are this many restarts within the window. Even a container that looks 'up' may have an insidious fault.",
  },
  "docker.stop_timeout": {
    label: "Stop grace period",
    help: "Docker first asks it to shut down gracefully (SIGTERM) and force-kills it when this expires. For database containers a short period can cause data loss.",
    unit: "sec",
  },
  "docker.log_tail_lines": {
    label: "History shown in the log window",
    unit: "lines",
  },
  "docker.autoprune.enabled": {
    label: "Automatic cleanup",
    help: "Off by default: bringing back a deleted image means downloading it again. Better to run it by hand first and see what it deletes.",
  },
  "docker.autoprune.cron": {
    label: "Automatic cleanup frequency",
  },
  "docker.autoprune.scope": {
    label: "Automatic cleanup scope",
    options: {
      "images-dangling": "Dangling images (safest)",
      "build-cache": "Build cache",
      "containers": "Stopped containers",
      "images-unused": "All unused images",
      "volumes": "Unattached volumes (DELETES DATA)",
    },
  },
  "updates.check_newer_tags": {
    label: "Look for newer version tags",
    help: "Until now the panel could only see that the CONTENT OF A TAG had changed: it reported an update to 'nginx:1.24' but could not see that 'nginx:1.26' had been released. With this on, the tag list in the registry is read too and a newer version is reported. The suggestion is not applied in one click — changing a tag means touching the compose file, and that decision is yours.",
  },
  "updates.max_bump": {
    label: "Largest jump to suggest",
    help: "Major releases usually carry breaking changes and you need to read the release notes before upgrading; hence the default of minor. Choosing major does not turn suggestions off, it only adds those to the list.",
    options: {
      "yama": "Patch only (1.4.2 → 1.4.3)",
      "minor": "Up to minor (→ 1.5.0)",
      "major": "Anything including major (→ 2.0.0)",
    },
  },
  "updates.match_flavor": {
    label: "Keep the tag flavour",
    help: "With this on, a container using '1.2-alpine' is only offered another '-alpine' tag, not a plain '1.5'. Changing flavour is not a version upgrade, it is moving to a different base image — turn this off and the panel will suggest it as if it were an upgrade. For images with many variants (php, node, postgres) this is the setting that cuts the most noise.",
  },
  "updates.include_prerelease": {
    label: "Suggest pre-releases too",
    help: "'-rc', '-beta', '-alpha' tags. While off these are never suggested; but if you are already on a pre-release (e.g. 1.5.0-rc1) the panel still shows the next pre-release and the final version — hiding them there would be pointless.",
  },
  "docker.update_vuln_gate": {
    label: "Security gate before updating",
    help: "BEFORE updating a container the panel scans the new image with Trivy and decides by this criterion. 'daha_kotu' (default): blocks only if the new image carries MORE vulnerabilities than the current one — it never blocks an improvement and never silently accepts a regression. 'kritik' and 'kritik_yuksek' are stricter but have a perverse effect: with 5 critical vulnerabilities in the current image they also block a new image that has 3, keeping you in the worse place. 'kapali' scans but does not block. During the scan the tag is put back on the old image, so a blocked update never touches the container.",
    options: {
      "daha_kotu": "Block only if it gets worse",
      "kritik": "Block if there is a critical vulnerability",
      "kritik_yuksek": "Block if there is a critical or high vulnerability",
      "kapali": "Scan but do not block",
    },
  },
  "docker.update_health_wait": {
    label: "Verification period after updating",
    help: "If the new container does not stay up for this long, the update is rolled back and the old container restored. Can be extended for slow-starting services (Home Assistant can take minutes).",
    unit: "sec",
  },
  "docker.exec_shell": {
    label: "Terminal shell",
    help: "Alpine-based images have no bash; 'auto' handles that for you.",
    options: {
      "auto": "Automatic (bash if present, otherwise sh)",
      "/bin/bash": "/bin/bash",
      "/bin/sh": "/bin/sh",
      "/bin/ash": "/bin/ash (alpine)",
    },
  },
  "docker.exec_idle_minutes": {
    label: "Terminal idle timeout",
    help: "A terminal whose tab was closed should not leave a shell inside the container; the session is closed after this period.",
    unit: "min",
  },
  "docker.show_stopped": {
    label: "Show stopped containers too",
  },
  "docker.image_export_max_mb": {
    label: "Image export limit",
    help: "The exported tar archive is held in the panel's memory before it is downloaded; leaving it unlimited would run the panel out of memory on a large image. For bigger images use 'docker save' on the server.",
    unit: "MB",
  },
  "docker.volume_op_timeout": {
    label: "Volume copy timeout",
    help: "Volume cloning is done with 'cp -a' in a one-shot container. On large volumes copying can take minutes; if this is exceeded the operation is cancelled and the half-finished target volume is deleted.",
    unit: "sec",
  },
  "docker.volume_export_max_mb": {
    label: "Volume export limit",
    help: "The exported archive is held in the panel's memory before it is downloaded; leaving it unlimited would run the panel out of memory on a large volume. For bigger volumes use the backup engine (restic). The limit does not apply to volumes whose size Docker cannot compute.",
    unit: "MB",
  },
  "docker.events_enabled": {
    label: "Listen to the Docker event stream",
    help: "Container start, stop, die and OOM events are read live from Docker and written to the event log. Containers killed for running out of memory (OOM) and those exiting with an unexpected code produce notifications; routine events such as start/stop are only recorded. If you do not want a container to notify, add the 'panel.notify=false' label to the compose file. Turning this off stops the stream; those events never appear again.",
  },
  "docker.events_retention_days": {
    label: "Docker event retention",
    help: "Docker events are written far more often than alerts (a row for every start/stop/restart), so they are kept separately and for a shorter time than general events. Docker events older than this are deleted by the pruning job; the panel's own alerts are unaffected.",
    unit: "days",
  },
  "docker.public_host": {
    label: "Server address for container links",
    help: "The published port badges in the container list link to this address (e.g. 192.168.61.114 or server.local). If left empty, the address you opened the panel on is used — if you reach the panel over Tailscale the links go there too, which may differ from the one on your local network. If a single container needs a different address, add a 'panel.url' or 'panel.port.<port>.url' label to the compose file; the label takes precedence over this setting.",
  },
  "network.scan_enabled": {
    label: "Automatic network scan",
    help: "Off by default: a scan attempts a connection to every address on your home network, and that should be something you turn on deliberately. The 'Scan now' button on the screen works regardless of this setting.",
  },
  "network.scan_cron": {
    label: "Scan frequency",
  },
  "network.subnet": {
    label: "Subnet to scan",
    help: "If left empty it is found from the server's own routing table (e.g. 192.168.61.0/24). Only the /16–/30 range is accepted.",
  },
  "network.probe_timeout": {
    label: "Wait per address",
    unit: "sec",
  },
  "network.scan_concurrency": {
    label: "Concurrent probes",
    help: "Raising it speeds up the scan but can strain a home router's ARP table.",
  },
  "network.oui_cron": {
    label: "Vendor list update",
    help: "IEEE's OUI list changes monthly; it is used to turn MAC addresses into vendor names. Without internet the vendor field stays empty and the device is still listed.",
  },
  "speedtest.enabled": {
    label: "Automatic speed test",
    help: "Off by default: each measurement downloads and uploads tens of megabytes, and on metered connections that is a cost.",
  },
  "speedtest.cron": {
    label: "Speed test frequency",
  },
  "speedtest.endpoint": {
    label: "Measurement server",
    help: "Cloudflare's public endpoints; they need no key and land on a nearby edge server. speedtest-cli was not installed: it would add tens of megabytes and a Python dependency to the image.",
  },
  "speedtest.duration_seconds": {
    label: "Measurement window",
    help: "The time counted for each direction; there is a short warm-up before it whose bytes are not counted. A fixed DURATION is measured rather than fixed BYTES: on a fast line a fixed byte count finishes in a tenth of a second and what you measure is noise, not the line. The window ends early if the byte ceiling below is reached.",
    unit: "sec",
  },
  "speedtest.max_bytes": {
    label: "Byte ceiling per direction",
    help: "If this many bytes have moved before the measurement window expires, it ends there. A cost brake for metered connections: on a gigabit line a 10-second window limited only by time moves over 1 GB per direction. The default is 500 MB — lines up to 400 Mbit never touch the ceiling and measure the full duration, while a gigabit line gets roughly a 4–5 second window (more than ten times what the old version measured).",
    unit: "bytes",
  },
  "speedtest.streams": {
    label: "Parallel streams",
    help: "How many connections are opened at once. A single stream cannot saturate a fast line and gives a result far below the real value; real speed test clients open 4–8 streams too.",
  },
  "speedtest.download_bytes": {
    label: "Download chunk per stream",
    help: "The chunk size each stream requests at a time; they are requested back to back until the window is full. Not the total traffic — that is set by duration and speed. NOTE: Cloudflare's public endpoint limits LARGE SINGLE REQUESTS — measured on the server, requests of 10 MB and above can get HTTP 429 and be blocked for about an hour, while 5 MB and below pass freely. Making it smaller is not free either: on the same line a 5 MB chunk measured 845 Mbit while a 1 MB chunk measured only 466 Mbit because of the per-request overhead.",
    unit: "bytes",
  },
  "speedtest.upload_bytes": {
    label: "Upload chunk per stream",
    help: "Since only COMPLETED uploads are counted, the chunk must be small enough to fit into the window several times. Choose it too large and no request finishes within the window, and the panel falls back to a single measurement.",
    unit: "bytes",
  },
  "speedtest.retention_days": {
    label: "Measurement retention",
    unit: "days",
  },
  "network.alert_unknown": {
    label: "Notify about a new unknown device",
    help: "On the first scan EVERY device counts as new and you would get a flood of notifications; that is why the first round produces none.",
  },
  "tailscale.key_warn_days": {
    label: "Warn this many days before key expiry",
    help: "A device whose node key expires drops off the tailnet SILENTLY — it is tracked with the same logic as certificate expiry. The default lifetime is 180 days.",
    unit: "days",
  },
  "tailscale.check_cron": {
    label: "Key check frequency",
  },
  "proxy.caddy_container": {
    label: "Caddy container name",
    help: "When the configuration changes, 'caddy reload' is run in this container. It is NOT restarted: reload keeps open connections alive, while a restart would also drop the panel's own session.",
  },
  "proxy.default_tls": {
    label: "TLS default for new records",
    help: "Only the starting value of the new-record form; it does not touch existing records. If you publish .local addresses on your local network, pick \"no TLS\": Let's Encrypt is never possible for those addresses, and a local CA means a certificate warning on every visit.",
    options: {
      "auto": "Let's Encrypt (real domain)",
      "internal": "Caddy local CA",
      "off": "No TLS (plain HTTP)",
    },
  },
  "proxy.diagnose_timeout_seconds": {
    label: "Publishing test timeout",
    help: "An upper bound for each step of the \"Test publishing\" button. Waiting indefinitely on an address that does not answer would lock up the diagnosis itself.",
    unit: "sec",
  },
  "proxy.diagnose_dns_server": {
    label: "DNS server to use in the test",
    help: "The panel container looks at public DNS (such as 1.1.1.1) and does not know local names (.local); so when it cannot resolve, the test asks the local DNS server directly. If left empty, whichever IP the panel was reached on is used — in home setups the local DNS is usually on the same machine. If Pi-hole is on another machine, write its IP.",
  },
  "proxy.cert_check_cron": {
    label: "Certificate check frequency",
  },
  "proxy.cert_warn_days": {
    label: "Warn this many days before expiry",
    help: "Let's Encrypt certificates last 90 days and renew 30 days out; 21 days is a reasonable bound for noticing that renewal is not working.",
    unit: "days",
  },
  "proxy.ddns_cron": {
    label: "DDNS check frequency",
    help: "If the IP has not changed, NO request goes to the provider; the cost of checking often is just one IP lookup.",
  },
  "proxy.public_ip_url": {
    label: "Public IP service",
    help: "Must return the IP as plain text. It is a setting because these services can shut down and the panel should not need rebuilding.",
  },
  "home.latitude": {
    label: "Latitude",
    help: "If both latitude and longitude are 0, no weather is shown. You can find your location on a map; Open-Meteo is used and no API key is needed.",
  },
  "home.longitude": {
    label: "Longitude",
  },
  "home.location_label": {
    label: "Location name",
    help: "Shown on screen only (e.g. \"Kadıköy\").",
  },
  "home.internet_check_url": {
    label: "Check address",
    help: "The address the big indicator on the household view looks at. If the server can reach it, the internet is called working. Checked once a minute.",
  },
  "home.kiosk_refresh": {
    label: "Kiosk refresh interval",
    help: "The wall-mounted screen refreshes itself at this interval. Separate from the panel's general refresh interval: on a kiosk, quiet matters more than fresh data.",
    unit: "sec",
  },
  "apps.server_host": {
    label: "Server address",
    help: "This replaces {host} in card addresses. If left empty, the address you opened the panel on is used — if you come in from your phone on 192.168.61.114 the cards point there, and if you come in on a domain name from outside, there. Write a fixed address here if you want one.",
  },
  "apps.widget_ttl": {
    label: "Widget data refresh interval",
    help: "The screen refreshes every few seconds; widget data is served from cache for this long. Shortening it means the panel puts load on the monitored service more often.",
    unit: "sec",
  },
  "apps.discovery_enabled": {
    label: "Create cards from Docker labels",
    help: "Cards are created only for LABELLED containers; no container becomes a card on its own.",
  },
  "apps.discovery_cron": {
    label: "Discovery frequency",
    help: "Can also be run by hand at any time with the 'Scan now' button on the Apps screen.",
  },
  "apps.label_prefix": {
    label: "Label prefix",
    help: "Adding the 'panel.enable=true' label to a container creates a card. Other labels: .name .url .port .scheme .path .description .category .icon .internal_url",
  },
  "apps.login_screen": {
    label: "Show ticked cards on the welcome page",
    help: "No card appears unless its own 'Show on welcome page' option is ticked; this button is for turning the whole list off in one go — without clearing the ticks one by one. If your panel is exposed, remember: anyone not signed in can see the name, logo and address of the cards on the welcome page.",
  },
  "welcome.notice": {
    label: "Announcement",
    help: "Appears as a banner at the top of the welcome page. If left EMPTY the banner is not drawn at all — that is the default for the announcement. Anyone not signed in can read what you write here; do not put details about the server, write something for the household (e.g. 'The internet will be down tonight between 9 and 11').",
  },
  "welcome.notice_level": {
    label: "Announcement colour",
    options: {
      "info": "Info (blue)",
      "warn": "Warning (orange)",
    },
  },
  "alerts.temp.warn": {
    label: "Temperature — warning threshold",
    help: "If the sensor reports its own threshold (most CPUs do) that value wins; this is only for those that do not.",
    unit: "°C",
  },
  "alerts.temp.crit": {
    label: "Temperature — critical threshold",
    unit: "°C",
  },
  "hardware.temp_sources": {
    label: "Sensors to monitor",
    help: "Comma-separated sensor ids (e.g. coretemp/temp1). If left empty, every sensor found is monitored.",
  },
  "hardware.raid.scrub_overdue_days": {
    label: "Scrub delay warning",
    help: "Warns if a RAID/ZFS pool has not been verified for this long. Silent data corruption is only caught by a scrub.",
    unit: "days",
  },
  "hardware.report_stale_hours": {
    label: "S.M.A.R.T report staleness threshold",
    help: "S.M.A.R.T and ZFS data is produced by scripts/hardware.sh running on the host. If the report is older than this you are warned — silently showing stale data is worse than showing none.",
    unit: "hours",
  },
  "alerts.capacity_forecast_days": {
    label: "Capacity warning horizon",
    help: "Warns if a disk looks like it will fill up within this period. Below half of it, the alert becomes critical.",
    unit: "days",
  },
  "capacity.window_days": {
    label: "History used for the trend",
    help: "A long window catches slow leaks, a short one reacts quickly to sudden change.",
    unit: "days",
  },
  "capacity.min_history_days": {
    label: "Minimum history for a forecast",
    help: "No forecast is made before this many days of data have accumulated. Saying 'full tomorrow' based on two hours of data turns a file copy into a disaster.",
    unit: "days",
  },
  "capacity.min_confidence": {
    label: "Fit required for an alert (R²)",
    help: "If the data shows no straight trend, the forecast is shown but raises no alert. Trusting a jumpy series means false alarms.",
    unit: "%",
  },
  "alerts.flap_threshold": {
    label: "Confirmation rounds before notifying",
    help: "A state is not reported until it has stayed the same for this many consecutive rounds. Keeps a value hovering at the threshold from ringing your phone over and over.",
  },
  "alerts.dedup_window": {
    label: "Interval before repeating the same alert",
    help: "The same problem is not reported again within this period. 0 = report every round (not recommended).",
    unit: "min",
  },
  "alerts.escalate_after": {
    label: "Remind about an unresolved critical alert",
    help: "A critical alert that persists for this long is reported again. 0 = off.",
    unit: "min",
  },
  "alerts.quiet_hours.enabled": {
    label: "Quiet hours",
    help: "No notifications are sent during this window; events are still recorded and visible in the panel.",
  },
  "alerts.quiet_hours.start": {
    label: "Quiet hours start",
  },
  "alerts.quiet_hours.end": {
    label: "Quiet hours end",
  },
  "alerts.quiet_hours.critical_bypass": {
    label: "Let critical alerts break quiet hours",
    help: "Tell me at night too if a disk is about to fill up or the server is unreachable.",
  },
  "alerts.retention_months": {
    label: "Event log retention",
    unit: "months",
  },
  "alerts.timeline_jump_pct": {
    label: "Jump threshold (percentage metrics)",
    help: "On the timeline, CPU, memory, disk and container measurements that rise by this many points from one minute to the next are marked. This is not an alert — it helps answer 'what happened right then' on the timeline.",
    unit: "points",
  },
  "alerts.timeline_net_jump_mbps": {
    label: "Jump threshold (network traffic)",
    help: "A separate threshold because network speed is an absolute value, not a percentage. It cannot be lowered to 0; to turn it off, switch off the jump filter on the timeline.",
    unit: "Mbit/s",
  },
  "notify.telegram.enabled": {
    label: "Enabled",
  },
  "notify.telegram.token": {
    label: "Bot token",
  },
  "notify.telegram.chat_id": {
    label: "Chat id",
    help: "NOT the bot's username but the numeric id (e.g. 123456789). After you send the bot a message it appears as result[0].message.chat.id at https://api.telegram.org/bot<TOKEN>/getUpdates.",
  },
  "notify.telegram.min_level": {
    label: "Minimum level",
    options: {
      "info": "Info and above",
      "warning": "Warning and above",
      "critical": "Critical only",
    },
  },
  "notify.ha.enabled": {
    label: "Enabled",
  },
  "notify.ha.url": {
    label: "Server address",
    help: "E.g. http://192.168.61.114:8123",
  },
  "notify.ha.token": {
    label: "Long-lived access token",
  },
  "notify.ha.service": {
    label: "Notification service",
    help: "E.g. notify.mobile_app_myphone",
  },
  "notify.ha.min_level": {
    label: "Minimum level",
    options: {
      "info": "Info and above",
      "warning": "Warning and above",
      "critical": "Critical only",
    },
  },
  "notify.ntfy.enabled": {
    label: "Enabled",
  },
  "notify.ntfy.url": {
    label: "Server address",
    help: "Default: https://ntfy.sh",
  },
  "notify.ntfy.topic": {
    label: "Topic",
  },
  "notify.ntfy.token": {
    label: "Access token (optional)",
  },
  "notify.ntfy.min_level": {
    label: "Minimum level",
    options: {
      "info": "Info and above",
      "warning": "Warning and above",
      "critical": "Critical only",
    },
  },
  "notify.discord.enabled": {
    label: "Enabled",
  },
  "notify.discord.webhook": {
    label: "Webhook address",
  },
  "notify.discord.min_level": {
    label: "Minimum level",
    options: {
      "info": "Info and above",
      "warning": "Warning and above",
      "critical": "Critical only",
    },
  },
  "notify.email.enabled": {
    label: "Enabled",
  },
  "notify.email.smtp_host": {
    label: "SMTP server",
  },
  "notify.email.smtp_port": {
    label: "SMTP port",
  },
  "notify.email.secure": {
    label: "TLS from the start (port 465)",
    help: "Leave off for 587 — STARTTLS is used automatically.",
  },
  "notify.email.user": {
    label: "Username",
  },
  "notify.email.password": {
    label: "Password",
  },
  "notify.email.from": {
    label: "Sender address",
  },
  "notify.email.to": {
    label: "Recipient addresses",
    help: "Separate with commas.",
  },
  "notify.email.min_level": {
    label: "Minimum level",
    options: {
      "info": "Info and above",
      "warning": "Warning and above",
      "critical": "Critical only",
    },
  },
  "updates.os_alert_level": {
    label: "When to warn",
    help: "The panel does NOT install updates; it only tells you. A kernel update needs a restart, and a panel that does that by itself at 3am causes more problems than it solves.",
    options: {
      "off": "Do not warn (show in the panel only)",
      "security": "Only for security updates",
      "any": "For any update",
    },
  },
  "updates.report_stale_hours": {
    label: "Report staleness threshold",
    help: "You are warned if os-updates.sh on the host has not run for this long — silently showing a stale list is worse than showing none.",
    unit: "hours",
  },
  "updates.image_check_cron": {
    label: "Image update check frequency",
    help: "Only the version digest is asked of the registry; the image is not downloaded.",
  },
  "updates.image_alert": {
    label: "Notify on a new image version",
    help: "Off by default: an image update is maintenance, not an urgent fault. It is always visible in the panel.",
  },
  "backup.watch_dir": {
    label: "Backup folder to watch",
    help: "The full path on the host (e.g. /mnt/backup). If left empty, tracking is off. The backup engine arrives in M3.4; this only answers 'when was the last backup taken'.",
  },
  "backup.stale_after_hours": {
    label: "Backup staleness threshold",
    help: "An alert is raised if the newest backup is older than this. The most insidious failure of a backup system is not crashing but stopping quietly.",
    unit: "hours",
  },
  "appstore.stacks_dir": {
    label: "Stack root directory",
    help: "Every stack installed from the panel is written into its own folder under this one. NOTE: this path must match the compose directory pattern in host-helper's allowlist — if it does not, the file is written but 'compose up' is refused by the host. Pointing it at your existing compose directory (e.g. /home/user/docker) is usually the most practical answer. The panel does not OVERWRITE an existing compose file. The Compose Stacks screen tests this directory on load and reports a mismatch BEFORE installation.",
  },
  "appstore.file_owner": {
    label: "Owner of installed files",
    help: "Chosen from the host's user and group lists (stored as uid:gid). The panel writes the compose file with a one-shot container running as root; the default is 0:0 because only root can write to paths like /opt. If the stack directory is your own home directory (e.g. /home/user/docker), set this to your own uid:gid — otherwise the installed files belong to root and you cannot edit them over SSH without sudo.",
  },
  "appstore.keep_backups": {
    label: "Compose backups to keep",
    help: "BEFORE editing a compose file the panel leaves a '<file>.panel-yedek-<time>' copy next to it; this sets how many of those are kept. Older ones are deleted automatically. The backups live in the stack directory, not in the panel's data area — you can restore them by hand over SSH too.",
  },
  "docker.file_max_kb": {
    label: "Container file size limit (KB)",
    help: "The largest file that can be read from and written into a container. Since the file passes through the panel's memory, leaving it unlimited could exhaust the panel with a single wrong click (e.g. opening a database file). Files over the limit appear in the list but do not open.",
  },
  "hostcron.forbidden": {
    label: "Forbidden command fragments",
    help: "Comma-separated strings. If a cron command contains any of them, the panel does not save it. This does not stop malice (anyone who is root on the host can write it anyway) — it stops accidents. Leaving it empty removes the limit.",
  },
  "console.forbidden": {
    label: "Forbidden command fragments",
    help: "Comma-separated strings. If a command typed into the console contains any of them, the panel never sends it to the host. Like host cron, this is accident protection, not a security boundary — the real boundary is the allowlist on the host. Leaving it empty removes the limit.",
  },
  "console.history_lines": {
    label: "Console output limit",
    help: "How many lines are kept in the console window. Beyond that the oldest lines drop; it keeps the browser from slowing down under a long `apt upgrade` output.",
    unit: "lines",
  },
  "dbadmin.max_rows": {
    label: "Query row limit",
    help: "This value is added automatically to every SELECT without a LIMIT, so that an accidental 'SELECT * FROM events' does not eat the panel's memory.",
    unit: "lines",
  },
  "dbadmin.timeout_seconds": {
    label: "Query timeout",
    help: "An upper bound for connecting and running the query. A query that exceeds it is cancelled.",
    unit: "sec",
  },
  "files.roots": {
    label: "Allowed root directories",
    help: "Folders are PICKED from a list — a hand-typed path used to produce a silent \"outside the allowed roots\" error. The file manager can see ONLY below these. If left empty, the file manager is turned off entirely. /proc, /sys, /dev and /run are unreachable even if they are in the list. /etc is NOT in the default: since reading runs with elevated privileges, making system configuration browsable should be a deliberate decision (shadow, sudoers and private keys stay unreadable even if you add it).",
  },
  "files.max_edit_kb": {
    label: "Editable file size limit",
    help: "Files larger than this are shown truncated in the editor; saving would cut the file, so it opens read-only.",
    unit: "KB",
  },
  "files.max_download_mb": {
    label: "Elevated download limit",
    help: "Files the panel user cannot read (owned by root) are downloaded through a temporary container by way of memory; hence a ceiling. Files the panel can read are streamed and are not subject to this limit.",
    unit: "MB",
  },
  "files.scan_timeout_seconds": {
    label: "Disk analysis time limit",
    help: "If computing folder sizes exceeds this, the results so far are shown and marked 'incomplete'. An unlimited scan takes minutes on large file systems.",
    unit: "sec",
  },
  "files.helper_image": {
    label: "Image for write operations",
    help: "The panel cannot write to the host directly (the host root is mounted read-only). Operations that need writing run in a one-shot container that mounts only the target folder as writable.",
  },
  "backup.restic_image": {
    label: "restic image",
    help: "Backups run inside a one-shot container built from this image, installing nothing on the host. To pin the version, change the tag (e.g. restic/restic:0.19.1).",
  },
  "backup.timeout_minutes": {
    label: "Backup timeout",
    help: "If a single restic command exceeds this, the job counts as failed. The first backup takes longest; later ones write only what changed.",
    unit: "min",
  },
  "logs.enabled": {
    label: "Log collection on",
    help: "Turning it off does not delete collected logs, it only stops new ones being added.",
  },
  "logs.sources": {
    label: "Containers to collect",
    help: "Containers are ticked from a list. If none are selected, every running container is collected. The panel's own container is never collected — it would grow by eating its own logs.",
  },
  "logs.max_lines_per_source": {
    label: "Per-source limit per round",
    help: "The most lines taken from a single source in one collection round. Stops a suddenly talkative container from consuming the whole round.",
    unit: "lines",
  },
  "logs.journald_enabled": {
    label: "Collect host journald logs too",
    help: "Read through host-helper and requires a 'journal.read' line in the allowlist (root adds it). Without that line, collection is skipped silently rather than failing.",
  },
  "logs.retention_days": {
    label: "Retention period",
    help: "Lines older than this are deleted by the pruning job.",
    unit: "days",
  },
  "logs.max_total_lines": {
    label: "Total line ceiling",
    help: "An age threshold alone is not enough: a single talkative container can push the database into gigabytes before the retention period expires. Past the ceiling, the oldest are cut.",
    unit: "lines",
  },
  "security.audit_retention_months": {
    label: "Audit log retention",
    help: "Audit records older than this are deleted by the pruning job.",
    unit: "months",
  },
  "security.trivy_image": {
    label: "Scanner image",
    help: "The CVE scan runs in a one-shot container built from this image. Trivy's vulnerability database is kept in a persistent volume; it is not downloaded again for every scan.",
  },
  "security.scan_timeout_minutes": {
    label: "Scan timeout",
    help: "The first scan takes longest: the vulnerability database is being downloaded (hundreds of MB).",
    unit: "min",
  },
  "security.trivy_remote": {
    label: "Read the image from the registry",
    help: "Off by default: the image is already local and reading it from Docker is fast. On large multi-layer images (e.g. Home Assistant, 3.4 GB) Trivy cannot read from Docker — a known limitation. This option downloads the image from the registry again; it works, but takes long and uses bandwidth.",
  },
  "security.scan_retention_days": {
    label: "Scan history retention",
    unit: "days",
  },
  "security.upnp_enabled": {
    label: "Ask the router for port forwards over UPnP",
    help: "Off by default. When on, the panel sends an SSDP broadcast to the local network and reads the UPnP records on the router. ONLY forwards opened via UPnP are visible — ones added by hand in the router interface may not appear.",
  },
  "security.upnp_timeout_seconds": {
    label: "UPnP timeout",
    unit: "sec",
  },
  "security.session_ttl_hours": {
    label: "Session lifetime",
    help: "The period that applies when \"Remember me\" is NOT ticked at sign-in. It applies to new sessions; existing ones are unaffected.",
    unit: "hours",
  },
  "security.remember_me_days": {
    label: "\"Remember me\" period",
    help: "Applies only when the box is ticked at sign-in; otherwise the hour value above is used. A long period also means the session stays open long after a device is lost — do not tick the box on a shared machine.",
    unit: "days",
  },
  "security.login_max_attempts": {
    label: "Failed attempts before the account locks",
  },
  "security.lockout_minutes": {
    label: "Lockout period",
    unit: "min",
  },
  "jobs.sessions_prune_cron": {
    label: "Session cleanup frequency",
  },
  "jobs.api_tokens_prune_cron": {
    label: "API key pruning frequency",
  },
  "jobs.audit_prune_cron": {
    label: "Audit pruning frequency",
  },
  "jobs.uptime_prune_cron": {
    label: "Uptime pruning frequency",
  },
  "jobs.events_prune_cron": {
    label: "Event log pruning frequency",
  },
  "jobs.logs_collect_cron": {
    label: "Log collection frequency",
    help: "Running it more often lowers the lag but every round means one Docker call per container. Five minutes is more than enough for search to be useful.",
  },
  "jobs.logs_prune_cron": {
    label: "Log pruning frequency",
  },
  "jobs.vuln_scan_cron": {
    label: "Vulnerability scan",
    help: "Once a week is enough: the vulnerability database updates daily but images do not change that fast, and the scan takes a while.",
  },
  "jobs.upnp_scan_cron": {
    label: "Port forward check",
    help: "Hourly. The point is to catch a forward opened without your knowledge, early.",
  },
  "jobs.port_scan_cron": {
    label: "Port map scan",
    help: "Hourly. If this job is off, the Port Map screen comes up empty the first time and the user has to scan by hand.",
  },
  "jobs.backup_scheduler_cron": {
    label: "Backup scheduler",
    help: "Every backup job has its own frequency; this setting only decides how often the 'check what is due' round runs. Running it often is cheap — with nothing due it does nothing.",
  },
  "jobs.mqtt_publish_cron": {
    label: "MQTT publish frequency",
    help: "How often metrics are published to MQTT. Publishing more often does not strain the broker (the messages are small and retained) but improves the resolution of charts in HA.",
  },
  "integration.mqtt.enabled": {
    label: "MQTT publishing on",
  },
  "integration.mqtt.host": {
    label: "Broker address",
    help: "If the Mosquitto container is on the same machine you can write the container name (e.g. mosquitto).",
  },
  "integration.mqtt.port": {
    label: "Port",
  },
  "integration.mqtt.tls": {
    label: "Use TLS",
    help: "LIMITATION: chain validation is off, for the self-signed certificates of home setups. So traffic IS ENCRYPTED but the broker's identity is NOT VERIFIED — someone able to get in the middle on the same network could impersonate the broker.",
  },
  "integration.mqtt.username": {
    label: "Username",
  },
  "integration.mqtt.password": {
    label: "Password",
  },
  "integration.mqtt.client_id": {
    label: "Client id",
    help: "Two clients cannot connect to a broker with the same id; change it if you use it elsewhere too.",
  },
  "integration.mqtt.base_topic": {
    label: "Root topic",
    help: "Metrics are published to <root>/metric/… , the combined state to <root>/state and events to <root>/event/<source>.",
  },
  "integration.mqtt.timeout_seconds": {
    label: "Connection timeout",
    unit: "sec",
  },
  "integration.mqtt.publish_events": {
    label: "Publish events too",
    help: "Alerts and events are published to MQTT the moment they occur (without being retained). On the HA side you can write 'notify me when the panel produces a critical event'.",
  },
  "integration.mqtt.discovery": {
    label: "Home Assistant auto-discovery",
    help: "When on, panel metrics appear in HA as sensors by themselves; no manual configuration is needed. When turned off the announcements are withdrawn and the entities are deleted from HA.",
  },
  "integration.mqtt.discovery_prefix": {
    label: "Discovery topic prefix",
    help: "Must match the 'discovery prefix' in HA's MQTT integration. If you have not changed the default, leave it alone.",
  },
  "integration.prometheus.enabled": {
    label: "/metrics endpoint on",
    help: "TIED to the External API master switch: /metrics also authenticates with a bearer token, so this setting has no effect while 'External API' is off.",
  },
  "integration.prometheus.include_containers": {
    label: "Include container metrics",
    help: "Means an extra row per container and an extra query on every scrape. The label uses the container NAME, not the id — the id changes on every recreate and would open a new time series in Prometheus each time.",
  },
  "api.enabled": {
    label: "External API on",
    help: "While off, /api/v1 and /metrics return 404. It ships off deliberately: opening the API opens a second way into the panel besides the password.",
  },
  "api.rate_limit_per_minute": {
    label: "Request limit per key",
    help: "Keeps a legitimate client from drowning the panel. Over the limit: 429 + Retry-After.",
    unit: "req/min",
  },
  "api.auth_rate_limit_per_minute": {
    label: "Failed auth attempts per IP",
    help: "Against key guessing and scanning. Only FAILED attempts count and a successful one resets the counter — so legitimate traffic behind a single IP is not punished.",
    unit: "attempts/min",
  },
  "api.token_default_ttl_days": {
    label: "Default lifetime of a new key",
    help: "0 = never expires. Can be changed on the key creation screen; this is only the default.",
    unit: "days",
  },
  "api.device_token_ttl_days": {
    label: "Mobile device key lifetime",
    help: "For the key generated automatically after device verification. Renewal creates a new key and revokes the old one; a leaked old value lives at most this long.",
    unit: "days",
  },
  "api.max_tokens_per_user": {
    label: "Active keys per user",
    help: "Only keys that have not been revoked count. If revoked ones counted too, a user who rotates keys would one day be locked out by their own history.",
    unit: "keys",
  },
  "api.max_body_bytes": {
    label: "Largest request body",
    unit: "bytes",
  },
  "api.last_used_write_interval": {
    label: "Last-used write interval",
    help: "A Prometheus scraping every 15 seconds means about 5,760 needless writes a day without throttling. When the IP changes, the threshold is not waited for.",
    unit: "sec",
  },
  "api.idempotency_window_seconds": {
    label: "Idempotency-Key window",
    help: "Must match host-helper's own replay window (default 300 s); two different periods leave an undefined zone in between.",
    unit: "sec",
  },
  "api.token_retention_days": {
    label: "Revoked key retention",
    help: "0 = never delete. Revocation rows are kept for the audit trail; this decides how long they stay.",
    unit: "days",
  },
};
