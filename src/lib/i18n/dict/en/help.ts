import type { HelpDict } from "../tr/help.ts";

export const help: HelpDict = {
  "/panel": {
    amac: "Your server at a glance: current CPU, memory, disk and network usage, container count, open alerts and the cards you picked.",
    nasil: "Metrics are recorded by a background collection job; this screen shows the latest record rather than measuring the server again on every visit. You can drag to choose which tiles appear and in what order — the layout is per user.",
    dikkat:
      "Values can lag by as much as the collection interval in settings. If you are chasing a problem happening right now, the charts on the Monitoring screen give finer resolution.",
  },

  "/apps": {
    amac: "A board of cards for reaching the services on your server in one click. Cards are grouped into categories, reordered by dragging, and can appear on the home screen too.",
    nasil:
      "You can add cards by hand or have them discovered automatically from Docker labels. When you pick a container, the address is filled in from its published port. The {host} placeholder in an address resolves to whatever address you reached the panel on — so the same card works from home and over the tailnet.",
    dikkat:
      "If you edit an automatically discovered card, the card becomes 'yours' and the discovery pass will not overwrite it again. If you delete a card while the label is still there, it comes back on the next pass; removing it for good means removing the container label.",
  },

  "/appstore": {
    amac: "Install your own docker-compose.yml from the panel and manage installed stacks. There used to be an app catalogue here and it was removed: despite hundreds of ready-made templates, what people actually did was always to bring their own compose file.",
    nasil:
      "Drag or pick a file; its contents open as an editable document. The 'Pre-check' button inspects the file BEFORE installing: port conflicts (it names who holds the port), services that need building, a missing restart policy, log settings that will grow without bound, anonymous volumes that are easy to delete, and external networks that do not exist. If it finds a blocker, installation does not start; suggestions apply in one click. The panel writes the file under the stack root directory, validates it with 'docker compose config', and only runs 'docker compose up' on the host if it is valid. After installation, starting, restarting, updating images and removing the stack all happen on the same screen.",
    dikkat:
      "The pre-check cannot catch everything: problems like an undefined ${VARIABLE} are only visible to 'compose config', and the panel prints its warnings after installation — that is the only early sign of silent failures such as 'the password was left empty'. The stack root directory must match the compose pattern in the host's allowlist. If it does not, a warning appears at the top of the screen along with the lines to paste. The panel never overwrites an existing compose file; 'Remove' leaves files and data on disk. You are responsible for what is in the file you upload — the panel validates it, but does not audit what it does.",
  },

  "/monitoring": {
    amac: "Charts of CPU, memory, disk, network and temperature history. This is where 'what happened last night' gets answered.",
    nasil:
      "Raw samples are rolled up over time into minute, hour and day tiers; picking a wide range uses a coarser but far faster tier. Retention windows are managed in settings.",
    dikkat:
      "Old data is deleted once its retention window passes — if you plan to compare over long periods, extend the windows in advance, because it cannot be brought back afterwards.",
  },

  "/uptime": {
    amac: "Polls your services at regular intervals to see whether they are up, and records outages. By defining maintenance windows you can stop planned downtime from raising alerts.",
    nasil:
      "Each monitor has its own interval and timeout. A single failed check does not raise an alert straight away: it must fail as many times in a row as the confirmation count in settings — so one-off network hiccups do not make noise.",
    dikkat:
      "Outages inside a maintenance window are recorded but send no notification, and they do not count towards the uptime percentage.",
  },

  "/events": {
    amac: "Every event and alert the panel produces: threshold breaches, service outages, certificate expiries, new network devices.",
    nasil:
      "Container start, stop, die, kill and OOM events are read live from Docker and written here with the 'docker' source. Containers killed for running out of memory (OOM) and those exiting with an unexpected code produce notifications; deliberate stops are only recorded. Alerts are managed through a state ledger — as long as a condition persists it is not reported over and over, but a new event is written when its state changes. The timeline view puts things that happened at the same moment side by side.",
    dikkat:
      "Events are pruned once their retention window passes. If you want to keep one for good, copy its detail. Docker events are written far more often than alerts, so they have their own, shorter retention window; both are changed in Settings. If you do not want a container's events to notify, add the panel.notify=false label to the compose file — the event is still recorded, only the notification is skipped.",
  },

  "/logs": {
    amac: "Collect container logs in one place and search them. You can see what each container wrote and when, without opening them one by one.",
    nasil:
      "A background collector reads container logs periodically and writes them to the database, remembering where it left off for each container — the same lines are never collected twice.",
    dikkat:
      "Because collection runs on an interval, the last few seconds may not be here yet. For a live stream, use the log tab on the Docker screen.",
  },

  "/docker": {
    amac: "See and manage containers: start, stop, restart, read logs, open a terminal inside. Also compose stacks, images, volumes and network management.",
    nasil:
      "Tabs: Containers, Stacks, Images, Volumes, Networks and Cleanup; each has Refresh, Search and a Clean button scoped to that tab, in the same place. The 'Add container' button on the Containers tab opens a window with two starting points: add a compose file, or pull an image. Both PRE-FILL the same 'container details' form (name, image, ports, volumes, environment variables, networks, restart policy) and every field is editable; whichever way you came, the container is only created when you press 'Create container' — adding YAML or pulling an image by itself brings nothing up. If the compose file has several services, you are asked which one to build the container from; port and volume lines that cannot be translated are skipped and reported as warnings. To bring up an interdependent multi-service stack with compose itself, the Stacks tab is there. The container list is FLAT — it is not grouped by compose project, because having been started with compose does not make an application a stack; stack membership is in the 'Stack' column and on the Stacks tab. The Stacks tab is the single address for compose stacks: opening a stack lists its members exactly as rows on the Containers tab, each row has Pull/Apply/Restart/Stop and a Compose editor, and new stacks are installed here too. On the Images tab you tag an image, remove a tag, and download an image as a tar. The Volumes tab has creation date and stack columns; clicking the name of a container that uses it opens its detail, clicking the stack name takes you to the Stacks tab, and 'Show files' lists the volume's root directory in a popup. The Networks tab opens in list view: you create a network, attach/detach containers, duplicate and delete networks; the map view is there for topology. Clicking a container name opens a tabbed window: General, Compose, Network, Environment, Files, Resources, Logs, Terminal and the raw Inspect output. For containers that do not belong to a compose stack, a 'Generate compose' tab appears instead of the Compose tab: it produces a docker-compose.yml from a container started by hand or with docker run, strips the noise inherited from the image, and can install it as a new stack — so that container becomes manageable with the panel's editors too. The checkboxes at the start of each row let you select several containers and start, stop, restart or delete them in bulk; the operations run in order and at the end each one's result is listed individually. Published port badges are clickable links. Logs render ANSI colours, the font size can be changed and the visible lines downloaded as .txt; in the terminal the shell (bash/sh/zsh/ash) and user are chosen per session. From a volume's detail you can clone the volume, download it as a tar, or browse its files. The Compose tab edits ports, networks, environment variables and the restart policy; the Files tab browses, downloads and edits the files INSIDE the container; the Resources tab shows CPU, memory, network and disk charts. Table columns are chosen with the 'Columns' button (IP, network/disk traffic, uptime, stack) and the choice is stored in your browser; click a header to sort. The map on the Networks tab shows which container is on which network, and which are on none. Long container names are truncated in the table with the full name in a tooltip; on narrow screens rows become cards, so the name is written in full. CPU and memory are measured at the interval in settings; the table does not make live Docker calls.",
    dikkat:
      "The panel's own container and the reverse proxy container CANNOT be selected for bulk operations and are excluded from automatic updates: if the panel stops itself the operation dies mid-way, and if the proxy stops the road to the panel closes. This lock is built into the code and cannot be opened with a label. Changing compose settings edits the stack's docker-compose.yml, not the container — before saving it shows the change line by line, takes a backup, and rolls back if the file turns out invalid. If 'compose up' fails the stack stays STOPPED; the panel says so in a separate red banner and offers to return to the backup in one click. If something else holds a port, saving is blocked: as it stands the stack definitely will not start. Changing container files is as powerful as taking over that application — writing requires the docker.action permission, is recorded in the audit log, /proc, /sys and /dev are closed to writes, and unless the change is on a volume it is lost when the container is recreated. Stopping and restarting are service outages and ask for confirmation. Environment variables whose names contain password/token are shown masked, but masking looks at the NAME — a value whose name does not give it away can be a secret too. panel.* labels written into the compose file change behaviour: panel.update=false excludes it from updates, panel.hidden=true from the list, panel.notify=false from notifications; panel.url and panel.port.<port>.url set the link address, panel.order the ordering, and panel.prune=false written on an image protects it from pruning. An unrecognised value falls back to the default, so a typo will not silently hide a container. Cloning a volume can copy a database's files while it is writing them — stop the container first for a consistent copy. Exporting a volume takes the archive into the panel's memory; the limit in settings applies for large volumes, and there the backup engine (restic) is the right tool.",
  },

  "/database": {
    amac: "Connect to the databases on your server from the panel, run queries, browse tables and export the result.",
    nasil:
      "Database containers in Docker can be detected automatically. SELECTs without a LIMIT get a row limit added automatically, so a broad query written by accident does not eat the panel's memory.",
    dikkat:
      "Writes are OFF by default and are enabled per connection. DELETE without a WHERE, DROP and TRUNCATE ask for extra confirmation. What you do on a connection you granted write access to cannot be undone.",
  },

  "/files": {
    amac: "Browse, download, upload and edit the files on your server from the panel.",
    nasil:
      "Access is limited to the root directories defined in settings; you cannot leave them, and climbing up with '..' is blocked.",
    dikkat:
      "Access to privileged paths goes through the helper service on the host and is subject to its allowlist. Deletions cannot be undone — there is no recycle bin.",
  },

  "/backup": {
    amac: "Regular backups of the panel's data and the directories you choose, plus listing and restoring backups.",
    nasil:
      "Before a backup is taken the database is brought to a consistent point; if you want, specific containers are stopped for the duration of the backup and started again afterwards.",
    dikkat:
      "The encryption key (MASTER_KEY) is DELIBERATELY left out of the backup — if you lose it, encrypted settings (tokens, passwords) cannot be recovered. Keep it somewhere separate, outside the panel.",
  },

  "/proxy": {
    amac: "Point a domain name at a service on your server, so you can type 'pihole.local' instead of 'http://192.168.1.10:8081'. Also certificate expiry tracking and dynamic DNS.",
    nasil:
      "The panel generates the reverse proxy configuration and puts it into effect. Records with TLS set to 'off' are served on the plain HTTP port and the rest on the HTTPS port — the list shows each record's full address as a clickable link.",
    dikkat:
      "For the domain to resolve you need a record in your local DNS (e.g. Pi-hole), and subdomains match exactly. If you give a container name as the target it must be on the same Docker network as the proxy; otherwise use the server's IP plus the published port. The 'Test publishing' button tries these three layers in order.",
  },

  "/network": {
    amac: "Discover the devices on your local network, keep an inventory, measure internet speed and wake machines with Wake-on-LAN.",
    nasil:
      "Scanning runs over the address range you set in settings; the MAC addresses found are matched against a vendor database to guess what the device is.",
    dikkat:
      "On the first scan every device looks 'new' and may produce events. Once you have marked the known ones, only genuinely new arrivals stand out.",
  },

  "/firewall": {
    amac: "Manage your server's firewall (ufw): add and delete rules, see the default incoming/outgoing policy, and turn the firewall on and off.",
    nasil:
      "Everything goes through the helper service on the host, and each action is enabled separately in the allowlist — that is how 'may see the rules but not change them' or 'may add rules but not turn the firewall off' gets expressed. The panel does not write the rule text: the host separately validates the pattern produced from the form.",
    dikkat:
      "Deny rules written for ports published by Docker DO NOT APPLY; Docker writes its own rules into a chain that runs before ufw. Those are the rows with the 'bypasses ufw' badge. Before enabling the firewall, make sure there is an allow rule for SSH and the panel port — the panel warns if one is missing, but the confirmation is yours.",
  },

  "/ports": {
    amac: "See which container or system service holds which port, and find a free port for a new container.",
    nasil:
      "The scan opens a temporary container attached to the host's network and PID namespaces and reads the socket table under /proc/net; the owner is resolved from the process's cgroup — both the container id and the systemd unit name are written there. The result is cached; the screen does not rescan every time it opens.",
    dikkat:
      "When looking for a free port, ports published by stopped containers also count as TAKEN: nobody is listening today, but they will conflict when that container starts. Ports with the 'published' badge in the list were published by Docker, and firewall rules do not apply to them.",
  },

  "/security": {
    amac: "Firewall rules, open ports, SSH keys, failed login attempts and known vulnerabilities in container images.",
    nasil:
      "Firewall and fail2ban information is read through the helper service on the host. The vulnerability scan runs a tool that scans the images and records the result.",
    dikkat:
      "Ports published by Docker bypass the firewall — if a container publishes a port it may be reachable from outside even though the firewall shows it as closed.",
  },

  "/host": {
    amac: "The server itself: console, system information, services, power operations, disk and hardware status, compose stacks.",
    nasil:
      "These operations cannot be done from inside a container; a signed request is sent to a small helper service running on the host. What may be run is decided by the allowlist on the host side, and the panel cannot change that list. For the ready-made console snippets the panel only sends a key — the command that runs is fixed on the host side.",
    dikkat:
      "The allowlist is deliberately narrow: shutdown, restarting services, stopping compose and the free-form console command are OFF by default. When an operation is refused, the panel tells you what is missing. The console is not a terminal: each command runs on its own, 'cd' does not affect the next one, and interactive commands time out.",
  },

  "/users": {
    amac: "Users, roles and open sessions. This is where you decide which screens each role sees and which operations it can perform.",
    nasil:
      "Permissions are granted through roles, not to users one by one. When you end a session here, that device is thrown out immediately.",
    dikkat:
      "Session tokens are not kept in the database in plain text, only their digests — which is why viewing an existing session's token is not possible.",
  },

  "/audit": {
    amac: "Who did what, and when, in the panel. Every operation that changes something lands here.",
    nasil:
      "The record is written together with the operation itself; failed attempts are recorded too, because 'who tried and failed' is often the more important question.",
    dikkat:
      "Records are pruned once their retention window passes. Read operations (e.g. SELECTs) are not recorded by default, so they do not make noise.",
  },

  "/jobs": {
    amac: "The jobs the panel runs in the background: metric collection, backups, certificate checks, network scans and the rest. You can see when they run, their latest results, and trigger them by hand.",
    nasil:
      "Each job's schedule comes from settings, not from the code. A lease-based lock keeps the same job from running twice at once; if the holder crashes, the job is freed when the lease expires.",
    dikkat:
      "Successful runs of frequent jobs are not written to history — otherwise the list would become meaningless. Failures are always recorded.",
  },

  "/hostcron": {
    amac: "The server's own scheduled tasks (crontab). Separate from the panel's own jobs; here you manage commands that run on the host.",
    nasil: "Tasks are read and written through the helper service on the host.",
    dikkat:
      "Destructive command fragments (e.g. 'rm -rf /') are refused by the panel. This is accident protection, not a security boundary — anyone who is root on the host can already write what they like.",
  },

  "/settings": {
    amac: "All of the panel's settings. Thresholds, retention windows, run frequencies and integrations are managed here.",
    nasil:
      "Settings live in the database and take effect immediately; there is no need to restart the server. Every setting has a default and can be put back with 'reset to default'.",
    dikkat:
      "Only deployment parameters (ports, the encryption key, the docker socket path) live in the .env file and cannot be changed from the panel.",
  },

  "/hesap": {
    amac: "Your own account: changing your password and setting up two-factor authentication (2FA).",
    nasil:
      "With 2FA on, the second step of signing in asks for the six-digit code from your app. The backup codes given during setup are your only way in if you lose your phone.",
    dikkat:
      "Save the backup codes somewhere safe — they are not shown again. Changing your password does not end your other sessions; you can end those from the Users screen.",
  },
};
