package hostinfo

import (
	"math"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

// MetricSample — providers/types.ts MetricSample (metric + label + value).
type MetricSample struct {
	Metric string  `json:"metric"`
	Label  string  `json:"label,omitempty"`
	Value  float64 `json:"value"`
}

type cpuTimes struct{ total, idle, iowait float64 }

type netCounters map[string][2]float64 // rx, tx

// Sampler — oran metrikleri (CPU %, ağ bps) iki okuma arasındaki farka
// dayanır; önceki okuma burada saklanır. İlk çağrı oran metriği İÇERMEZ.
type Sampler struct {
	Roots Roots
	// Statfs — disk doluluğu; testte değiştirilir.
	Statfs func(path string) (total, free, avail uint64, err error)
	// Now — testte değiştirilir.
	Now func() time.Time

	mu      sync.Mutex
	prevCPU *cpuTimes
	prevNet *struct {
		at       time.Time
		counters netCounters
	}
}

func NewSampler(roots Roots) *Sampler {
	return &Sampler{Roots: roots, Statfs: statfs, Now: time.Now}
}

// Ayarlar — merkezin isteğe eklediği `settings` (monitoring.disks,
// monitoring.net_interfaces). Boşsa otomatik seçim.
type MetricSettings struct {
	Disks         []string
	NetInterfaces []string
}

func splitList(value any) []string {
	text, _ := value.(string)
	var out []string
	for _, part := range strings.Split(text, ",") {
		if part = strings.TrimSpace(part); part != "" {
			out = append(out, part)
		}
	}
	return out
}

// MetricSettingsFrom — RPC `settings` haritasından.
func MetricSettingsFrom(settings map[string]any) MetricSettings {
	return MetricSettings{
		Disks:         splitList(settings["monitoring.disks"]),
		NetInterfaces: splitList(settings["monitoring.net_interfaces"]),
	}
}

// Sample — metrics.sample op'u.
func (s *Sampler) Sample(cfg MetricSettings) []MetricSample {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := []MetricSample{}
	out = append(out, s.cpu()...)
	out = append(out, s.memory()...)
	out = append(out, s.load()...)
	out = append(out, s.uptime()...)
	out = append(out, s.disks(cfg.Disks)...)
	out = append(out, s.net(cfg.NetInterfaces)...)
	return out
}

func clampPct(value float64) float64 {
	rounded := math.Round(value*100) / 100
	return math.Min(100, math.Max(0, rounded))
}

// readProc — /proc/mounts ve /proc/net/dev sürecin KENDİ ad alanını
// gösterir; host görünümü PID 1'den okunur (merkezdeki tuzak notu). Native
// ajan host'ta çalıştığı için ikisi aynıdır, yine de sıra korunur.
func (s *Sampler) readProc(file string) (string, bool) {
	if file == "mounts" || file == "net/dev" {
		if content, ok := readText(filepath.Join(s.Roots.Proc, "1", file)); ok {
			return content, true
		}
	}
	return readText(filepath.Join(s.Roots.Proc, file))
}

func parseCPU(content string) *cpuTimes {
	for _, line := range strings.Split(content, "\n") {
		if !strings.HasPrefix(line, "cpu ") {
			continue
		}
		fields := strings.Fields(line)[1:]
		if len(fields) < 5 {
			return nil
		}
		nums := make([]float64, 0, len(fields))
		for _, f := range fields {
			n, err := strconv.ParseFloat(f, 64)
			if err != nil {
				return nil
			}
			nums = append(nums, n)
		}
		// guest ve guest_nice zaten user/nice içinde; toplamda tekrar sayılmaz.
		total := 0.0
		for i := 0; i < len(nums) && i < 8; i++ {
			total += nums[i]
		}
		return &cpuTimes{total: total, idle: nums[3], iowait: nums[4]}
	}
	return nil
}

func (s *Sampler) cpu() []MetricSample {
	content, ok := s.readProc("stat")
	if !ok {
		return nil
	}
	now := parseCPU(content)
	if now == nil {
		return nil
	}
	prev := s.prevCPU
	s.prevCPU = now
	if prev == nil {
		return nil
	}
	totalDelta := now.total - prev.total
	if totalDelta <= 0 {
		return nil
	}
	idleDelta := now.idle - prev.idle + (now.iowait - prev.iowait)
	return []MetricSample{
		{Metric: "cpu.pct", Value: clampPct((totalDelta - idleDelta) / totalDelta * 100)},
		{Metric: "cpu.iowait_pct", Value: clampPct((now.iowait - prev.iowait) / totalDelta * 100)},
	}
}

func (s *Sampler) memory() []MetricSample {
	values := s.Roots.meminfo()
	total := float64(values["MemTotal"])
	if total == 0 {
		return nil
	}
	// MemAvailable çekirdeğin "verilebilir" tahmini; free+cache'ten doğru.
	available, ok := values["MemAvailable"]
	if !ok {
		available = values["MemFree"]
	}
	used := total - float64(available)
	out := []MetricSample{
		{Metric: "mem.total", Value: total},
		{Metric: "mem.used", Value: used},
		{Metric: "mem.used_pct", Value: clampPct(used / total * 100)},
	}
	if swapTotal := float64(values["SwapTotal"]); swapTotal > 0 {
		swapUsed := swapTotal - float64(values["SwapFree"])
		out = append(out,
			MetricSample{Metric: "swap.used", Value: swapUsed},
			MetricSample{Metric: "swap.used_pct", Value: clampPct(swapUsed / swapTotal * 100)},
		)
	}
	return out
}

func (s *Sampler) load() []MetricSample {
	content, ok := s.readProc("loadavg")
	if !ok {
		return nil
	}
	fields := strings.Fields(content)
	if len(fields) < 3 {
		return nil
	}
	var vals [3]float64
	for i := 0; i < 3; i++ {
		n, err := strconv.ParseFloat(fields[i], 64)
		if err != nil {
			return nil
		}
		vals[i] = n
	}
	return []MetricSample{
		{Metric: "load.1m", Value: vals[0]},
		{Metric: "load.5m", Value: vals[1]},
		{Metric: "load.15m", Value: vals[2]},
	}
}

func (s *Sampler) uptime() []MetricSample {
	content, ok := s.readProc("uptime")
	if !ok {
		return nil
	}
	fields := strings.Fields(content)
	if len(fields) == 0 {
		return nil
	}
	seconds, err := strconv.ParseFloat(fields[0], 64)
	if err != nil {
		return nil
	}
	return []MetricSample{{Metric: "uptime.seconds", Value: seconds}}
}

// Gerçek veri tutan dosya sistemleri; tmpfs/overlay/proc elenir.
var realFsTypes = map[string]bool{
	"ext2": true, "ext3": true, "ext4": true, "xfs": true, "btrfs": true, "zfs": true,
	"f2fs": true, "jfs": true, "reiserfs": true, "vfat": true, "exfat": true, "ntfs": true,
	"ntfs3": true, "hfsplus": true, "ufs": true, "bcachefs": true,
}

func isNoisyMount(mountpoint string) bool {
	return strings.HasPrefix(mountpoint, "/snap/") ||
		strings.HasPrefix(mountpoint, "/var/lib/docker/") ||
		strings.HasPrefix(mountpoint, "/var/snap/") ||
		strings.HasPrefix(mountpoint, "/boot/efi")
}

// ParseMounts — /proc/mounts'tan gerçek, gürültüsüz bölümler. Aynı cihaz
// birden çok yere bağlıysa en kısa yol tutulur ("/" görmek isteriz).
func ParseMounts(content string) []string {
	byMount := map[string]bool{}
	seen := map[string]string{}
	for _, line := range strings.Split(content, "\n") {
		fields := strings.Fields(line)
		if len(fields) < 3 || !realFsTypes[fields[2]] {
			continue
		}
		device := fields[0]
		mountpoint := strings.ReplaceAll(fields[1], `\040`, " ")
		if isNoisyMount(mountpoint) {
			continue
		}
		if existing, ok := seen[device]; ok {
			if len(existing) <= len(mountpoint) {
				continue
			}
			delete(byMount, existing)
		}
		seen[device] = mountpoint
		byMount[mountpoint] = true
	}
	out := make([]string, 0, len(byMount))
	for mount := range byMount {
		out = append(out, mount)
	}
	sort.Strings(out)
	return out
}

func (s *Sampler) disks(configured []string) []MetricSample {
	mounts := configured
	if len(mounts) == 0 {
		content, ok := s.readProc("mounts")
		if !ok {
			return nil
		}
		mounts = ParseMounts(content)
	}
	var out []MetricSample
	for _, mount := range mounts {
		probe := s.Roots.Root
		if mount != "/" {
			probe = filepath.Join(s.Roots.Root, mount)
		}
		total, free, avail, err := s.Statfs(probe)
		if err != nil || total == 0 {
			continue // bağlı değil ya da erişilemiyor — sessizce atla
		}
		// df ile aynı hesap: kullanılan = toplam - boş (rezerve dahil),
		// kullanılabilir = ayrıcalıksız kullanıcıya kalan.
		used := float64(total - free)
		available := float64(avail)
		pct := 0.0
		if used+available > 0 {
			pct = clampPct(used / (used + available) * 100)
		}
		out = append(out,
			MetricSample{Metric: "disk.total", Label: mount, Value: float64(total)},
			MetricSample{Metric: "disk.used", Label: mount, Value: used},
			MetricSample{Metric: "disk.free", Label: mount, Value: available},
			MetricSample{Metric: "disk.used_pct", Label: mount, Value: pct},
		)
	}
	return out
}

// ParseNetDev — /proc/net/dev sayaçları (rx, tx bayt).
func ParseNetDev(content string) netCounters {
	counters := netCounters{}
	lines := strings.Split(content, "\n")
	if len(lines) > 2 {
		lines = lines[2:]
	}
	for _, line := range lines {
		name, rest, found := strings.Cut(line, ":")
		if !found {
			continue
		}
		fields := strings.Fields(rest)
		if len(fields) < 10 {
			continue
		}
		rx, err1 := strconv.ParseFloat(fields[0], 64)
		tx, err2 := strconv.ParseFloat(fields[8], 64)
		if err1 != nil || err2 != nil {
			continue
		}
		counters[strings.TrimSpace(name)] = [2]float64{rx, tx}
	}
	return counters
}

// Fiziksel arayüzler /sys altında `device` bağlantısı taşır; veth/bridge taşımaz.
func (s *Sampler) isPhysical(iface string) bool {
	_, err := os.Stat(filepath.Join(s.Roots.Sys, "class/net", iface, "device"))
	return err == nil
}

func (s *Sampler) net(configured []string) []MetricSample {
	content, ok := s.readProc("net/dev")
	if !ok {
		return nil
	}
	counters := ParseNetDev(content)
	var selected []string
	for iface := range counters {
		if iface == "lo" {
			continue
		}
		if len(configured) > 0 {
			for _, want := range configured {
				if want == iface {
					selected = append(selected, iface)
				}
			}
		} else if s.isPhysical(iface) {
			selected = append(selected, iface)
		}
	}
	sort.Strings(selected)

	now := s.Now()
	prev := s.prevNet
	s.prevNet = &struct {
		at       time.Time
		counters netCounters
	}{now, counters}
	if prev == nil {
		return nil
	}
	elapsed := now.Sub(prev.at).Seconds()
	if elapsed <= 0 {
		return nil
	}
	var out []MetricSample
	for _, iface := range selected {
		before, okBefore := prev.counters[iface]
		after, okAfter := counters[iface]
		if !okBefore || !okAfter {
			continue
		}
		// Sayaç sarması / arayüz sıfırlanması: negatif fark uydurma zirve üretmesin.
		rx := after[0] - before[0]
		tx := after[1] - before[1]
		if rx < 0 || tx < 0 {
			continue
		}
		out = append(out,
			MetricSample{Metric: "net.rx_bps", Label: iface, Value: math.Round(rx / elapsed)},
			MetricSample{Metric: "net.tx_bps", Label: iface, Value: math.Round(tx / elapsed)},
		)
	}
	return out
}
