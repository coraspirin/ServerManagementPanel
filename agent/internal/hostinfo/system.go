// Package hostinfo — host'un /proc, /sys ve /etc dosyalarından okunan
// bilgiler. Merkezdeki src/lib/providers/{system,metrics,hardware}.live.ts
// sözleşmeleriyle (alan adları, birimler, ilk çağrıda oran metriklerinin
// olmaması) aynı. Native ajan host'ta çalıştığı için varsayılan yollar
// doğrudan /proc, /sys ve /; testler ve container içinde çalıştırma için
// kökler değiştirilebilir.
package hostinfo

import (
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"strconv"
	"strings"
)

// Roots — okunacak dosya sistemi kökleri.
type Roots struct {
	Proc string // /proc
	Sys  string // /sys
	Root string // / (statfs ve /etc için)
}

// DefaultRoots — HOST_PROC / HOST_SYS / HOST_ROOT_FS ile değiştirilebilir.
func DefaultRoots() Roots {
	return Roots{
		Proc: envOr("HOST_PROC", "/proc"),
		Sys:  envOr("HOST_SYS", "/sys"),
		Root: envOr("HOST_ROOT_FS", "/"),
	}
}

func envOr(key, fallback string) string {
	if value := strings.TrimSpace(os.Getenv(key)); value != "" {
		return value
	}
	return fallback
}

func readText(path string) (string, bool) {
	data, err := os.ReadFile(path)
	if err != nil {
		return "", false
	}
	return string(data), true
}

// SystemInfo — providers/types.ts SystemInfo.
type SystemInfo struct {
	Hostname      string  `json:"hostname"`
	Platform      string  `json:"platform"`
	Release       string  `json:"release"`
	OsName        *string `json:"osName"`
	Arch          string  `json:"arch"`
	CPUModel      string  `json:"cpuModel"`
	CPUCount      int     `json:"cpuCount"`
	TotalMemBytes int64   `json:"totalMemBytes"`
	UptimeSeconds int64   `json:"uptimeSeconds"`
}

var prettyNameRe = regexp.MustCompile(`(?m)^PRETTY_NAME="?(.+?)"?$`)

// OsName — /etc/os-release PRETTY_NAME; yoksa nil.
func (r Roots) OsName() *string {
	content, ok := readText(filepath.Join(r.Root, "etc/os-release"))
	if !ok {
		return nil
	}
	if m := prettyNameRe.FindStringSubmatch(content); m != nil {
		name := strings.TrimSpace(m[1])
		return &name
	}
	return nil
}

// Hostname — /etc/hostname, yoksa çekirdeğin bildirdiği ad.
func (r Roots) Hostname() string {
	if content, ok := readText(filepath.Join(r.Root, "etc/hostname")); ok {
		if name := strings.TrimSpace(content); name != "" {
			return name
		}
	}
	if content, ok := readText(filepath.Join(r.Proc, "sys/kernel/hostname")); ok {
		if name := strings.TrimSpace(content); name != "" {
			return name
		}
	}
	name, _ := os.Hostname()
	return name
}

// NodeArch — Node'un os.arch() adları (merkez arayüzü bunları bekliyor).
func NodeArch(goarch string) string {
	switch goarch {
	case "amd64":
		return "x64"
	case "386":
		return "ia32"
	default:
		return goarch // arm, arm64, riscv64…
	}
}

// Info — system.info op'u.
func (r Roots) Info() SystemInfo {
	model, count := r.cpuInfo()
	release := ""
	if content, ok := readText(filepath.Join(r.Proc, "sys/kernel/osrelease")); ok {
		release = strings.TrimSpace(content)
	}
	var total int64
	if mem := r.meminfo(); mem != nil {
		total = mem["MemTotal"]
	}
	var uptime int64
	if content, ok := readText(filepath.Join(r.Proc, "uptime")); ok {
		if fields := strings.Fields(content); len(fields) > 0 {
			if seconds, err := strconv.ParseFloat(fields[0], 64); err == nil {
				uptime = int64(seconds + 0.5)
			}
		}
	}
	return SystemInfo{
		Hostname:      r.Hostname(),
		Platform:      runtime.GOOS,
		Release:       release,
		OsName:        r.OsName(),
		Arch:          NodeArch(runtime.GOARCH),
		CPUModel:      model,
		CPUCount:      count,
		TotalMemBytes: total,
		UptimeSeconds: uptime,
	}
}

// cpuInfo — model adı ve mantıksal çekirdek sayısı. ARM'da "model name"
// her işlemci bloğunda tekrarlanır; bazı çekirdeklerde yalnız "Hardware" /
// "Model" satırı vardır.
func (r Roots) cpuInfo() (string, int) {
	content, ok := readText(filepath.Join(r.Proc, "cpuinfo"))
	if !ok {
		return "bilinmiyor", runtime.NumCPU()
	}
	model := ""
	count := 0
	fallback := ""
	for _, line := range strings.Split(content, "\n") {
		key, value, found := strings.Cut(line, ":")
		if !found {
			continue
		}
		key = strings.TrimSpace(key)
		value = strings.TrimSpace(value)
		switch key {
		case "processor":
			count++
		case "model name":
			if model == "" {
				model = value
			}
		case "Model", "Hardware":
			if fallback == "" {
				fallback = value
			}
		}
	}
	if model == "" {
		model = fallback
	}
	if model == "" {
		model = "bilinmiyor"
	}
	if count == 0 {
		count = runtime.NumCPU()
	}
	return model, count
}

var meminfoRe = regexp.MustCompile(`^(\w+):\s+(\d+)\s*kB$`)

// meminfo — bayt cinsinden /proc/meminfo alanları.
func (r Roots) meminfo() map[string]int64 {
	content, ok := readText(filepath.Join(r.Proc, "meminfo"))
	if !ok {
		return nil
	}
	values := map[string]int64{}
	for _, line := range strings.Split(content, "\n") {
		if m := meminfoRe.FindStringSubmatch(strings.TrimRight(line, "\r")); m != nil {
			n, _ := strconv.ParseInt(m[2], 10, 64)
			values[m[1]] = n * 1024
		}
	}
	return values
}
