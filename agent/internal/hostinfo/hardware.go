package hostinfo

import (
	"encoding/json"
	"math"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"

	"github.com/coraspirin/servermanagementpanel/agent/internal/i18n"
)

// Donanım sağlığı — providers/hardware.live.ts ile aynı iş bölümü:
// sıcaklık ve mdraid doğrudan okunur; S.M.A.R.T ve ZFS host'taki
// scripts/hardware.sh'ın bıraktığı JSON'dan gelir (ham disk erişimi ajana
// verilmez).

type TemperatureReading struct {
	ID        string   `json:"id"`
	Source    string   `json:"source"`
	Label     string   `json:"label"`
	Celsius   float64  `json:"celsius"`
	HighC     *float64 `json:"highC"`
	CriticalC *float64 `json:"criticalC"`
}

type PoolDevice struct {
	Name  string `json:"name"`
	State string `json:"state"`
}

type StoragePool struct {
	Name        string       `json:"name"`
	Kind        string       `json:"kind"`
	State       string       `json:"state"`
	Healthy     bool         `json:"healthy"`
	Detail      string       `json:"detail"`
	Devices     []PoolDevice `json:"devices"`
	LastScrubAt *float64     `json:"lastScrubAt"`
	ScrubResult *string      `json:"scrubResult"`
}

type HardwareReport struct {
	Temperatures []TemperatureReading `json:"temperatures"`
	// Disks ve host rapordaki havuzlar olduğu gibi aktarılır (biçimi host
	// betiği belirliyor; ajan yorumlamaz).
	Disks          []json.RawMessage `json:"disks"`
	Pools          []any             `json:"pools"`
	ReportedAt     *float64          `json:"reportedAt"`
	Virtualization *string           `json:"virtualization"`
	Notes          []string          `json:"notes"`
}

func milliToCelsius(raw string) (float64, bool) {
	value, err := strconv.ParseFloat(strings.TrimSpace(raw), 64)
	if err != nil {
		return 0, false
	}
	return math.Round(value/100) / 10, true
}

func readTrim(path string) (string, bool) {
	content, ok := readText(path)
	if !ok {
		return "", false
	}
	return strings.TrimSpace(content), true
}

var tempInputRe = regexp.MustCompile(`^temp\d+_input$`)

func (r Roots) temperatures(locale string, notes *[]string) []TemperatureReading {
	base := filepath.Join(r.Sys, "class/hwmon")
	entries, err := os.ReadDir(base)
	if err != nil {
		*notes = append(*notes, i18n.T(locale, "hardwareLib.sensorDir", map[string]any{"path": base}))
		return []TemperatureReading{}
	}
	readings := []TemperatureReading{}
	for _, entry := range entries {
		dir := filepath.Join(base, entry.Name())
		source, ok := readTrim(filepath.Join(dir, "name"))
		if !ok || source == "" {
			source = entry.Name()
		}
		files, err := os.ReadDir(dir)
		if err != nil {
			continue
		}
		for _, file := range files {
			if !tempInputRe.MatchString(file.Name()) {
				continue
			}
			prefix := strings.TrimSuffix(file.Name(), "_input")
			raw, ok := readText(filepath.Join(dir, file.Name()))
			if !ok {
				continue
			}
			celsius, ok := milliToCelsius(raw)
			// 0 °C okuyan sensör neredeyse her zaman bağlı olmayan bir kanal.
			if !ok || celsius == 0 {
				continue
			}
			label, ok := readTrim(filepath.Join(dir, prefix+"_label"))
			if !ok {
				label = strings.Replace(prefix, "temp", i18n.T(locale, "hardwareLib.sensor", nil), 1)
			}
			reading := TemperatureReading{ID: source + "/" + prefix, Source: source, Label: label, Celsius: celsius}
			if raw, ok := readText(filepath.Join(dir, prefix+"_max")); ok {
				if v, ok := milliToCelsius(raw); ok {
					reading.HighC = &v
				}
			}
			if raw, ok := readText(filepath.Join(dir, prefix+"_crit")); ok {
				if v, ok := milliToCelsius(raw); ok {
					reading.CriticalC = &v
				}
			}
			readings = append(readings, reading)
		}
	}
	sort.Slice(readings, func(i, j int) bool { return readings[i].ID < readings[j].ID })
	return readings
}

var (
	mdHeaderRe = regexp.MustCompile(`^(md\d+)\s*:\s*(\w+)\s+(\S+)\s+(.*)$`)
	mdMemberRe = regexp.MustCompile(`(\w+)\[\d+\](\(([FS])\))?`)
	mdStatusRe = regexp.MustCompile(`\[(\d+)/(\d+)\]\s*\[([U_]+)\]`)
	mdResyncRe = regexp.MustCompile(`(resync|recovery|reshape|check)\s*=\s*([\d.]+%)`)
)

// ParseMdstat — /proc/mdstat. `[2/2] [UU]` sağlıklı, `[2/1] [U_]` bir disk düşmüş.
func ParseMdstat(content, locale string) []StoragePool {
	pools := []StoragePool{}
	lines := strings.Split(content, "\n")
	for i, line := range lines {
		header := mdHeaderRe.FindStringSubmatch(line)
		if header == nil {
			continue
		}
		name, activity, level, members := header[1], header[2], header[3], header[4]
		devices := []PoolDevice{}
		for _, m := range mdMemberRe.FindAllStringSubmatch(members, -1) {
			state := i18n.T(locale, "hardwareLib.device.active", nil)
			switch m[3] {
			case "F":
				state = i18n.T(locale, "hardwareLib.device.failed", nil)
			case "S":
				state = i18n.T(locale, "hardwareLib.device.spare", nil)
			}
			devices = append(devices, PoolDevice{Name: m[1], State: state})
		}
		end := i + 4
		if end > len(lines) {
			end = len(lines)
		}
		body := strings.Join(lines[i+1:end], " ")
		status := mdStatusRe.FindStringSubmatch(body)
		resync := mdResyncRe.FindStringSubmatch(body)

		total, active := len(devices), len(devices)
		if status != nil {
			total, _ = strconv.Atoi(status[1])
			active, _ = strconv.Atoi(status[2])
		}
		degraded := active < total
		state := activity
		if resync != nil {
			state = resync[1] + " (" + resync[2] + ")"
		} else if degraded {
			state = "degraded"
		}
		detail := level + " · " + strconv.Itoa(active) + "/" + strconv.Itoa(total) + " disk etkin"
		if status != nil {
			detail += " [" + status[3] + "]"
		}
		pools = append(pools, StoragePool{
			Name: name, Kind: "mdraid", State: state, Healthy: !degraded && activity == "active",
			Detail: detail, Devices: devices,
		})
	}
	return pools
}

type reportFile struct {
	GeneratedAt *float64          `json:"generatedAt"`
	Disks       []json.RawMessage `json:"disks"`
	Pools       []json.RawMessage `json:"pools"`
	Errors      []string          `json:"errors"`
}

func readHostReport(dir, locale string, notes *[]string) *reportFile {
	file := filepath.Join(dir, "hardware.json")
	content, ok := readText(file)
	if !ok {
		*notes = append(*notes, i18n.T(locale, "hardwareLib.noReport", nil))
		return nil
	}
	var parsed reportFile
	if err := json.Unmarshal([]byte(strings.TrimSpace(content)), &parsed); err != nil {
		*notes = append(*notes, i18n.T(locale, "hardwareLib.reportInvalid", map[string]any{"file": file}))
		return nil
	}
	for _, e := range parsed.Errors {
		*notes = append(*notes, "Host raporu: "+e)
	}
	return &parsed
}

var virtualizations = []struct {
	re   *regexp.Regexp
	name string
}{
	{regexp.MustCompile(`(?i)microsoft|hyper-v`), "Hyper-V sanal makinesi"},
	{regexp.MustCompile(`(?i)vmware`), "VMware sanal makinesi"},
	{regexp.MustCompile(`(?i)qemu|kvm|bochs`), "QEMU/KVM sanal makinesi"},
	{regexp.MustCompile(`(?i)virtualbox|innotek`), "VirtualBox sanal makinesi"},
	{regexp.MustCompile(`(?i)xen`), "Xen sanal makinesi"},
}

func (r Roots) virtualization() *string {
	vendor, _ := readTrim(filepath.Join(r.Sys, "class/dmi/id/sys_vendor"))
	product, _ := readTrim(filepath.Join(r.Sys, "class/dmi/id/product_name"))
	text := strings.TrimSpace(vendor + " " + product)
	for _, v := range virtualizations {
		if v.re.MatchString(text) {
			name := v.name
			return &name
		}
	}
	return nil
}

// Hardware — hardware.report op'u. reportsDir: host betiğinin JSON dizini.
func (r Roots) Hardware(reportsDir string, settings map[string]any) HardwareReport {
	locale := i18n.Locale(settings)
	notes := []string{}
	temperatures := r.temperatures(locale, &notes)
	pools := []any{}
	if content, ok := readText(filepath.Join(r.Proc, "mdstat")); ok {
		for _, pool := range ParseMdstat(content, locale) {
			pools = append(pools, pool)
		}
	}
	report := readHostReport(reportsDir, locale, &notes)
	disks := []json.RawMessage{}
	var reportedAt *float64
	if report != nil {
		for _, pool := range report.Pools {
			pools = append(pools, pool)
		}
		if report.Disks != nil {
			disks = report.Disks
		}
		reportedAt = report.GeneratedAt
	}
	virtual := r.virtualization()
	if virtual != nil && len(temperatures) == 0 && len(disks) == 0 {
		// En üste: asıl açıklama bu, diğer notlar sonucu.
		notes = append([]string{i18n.T(locale, "hardwareLib.virtual", map[string]any{"kind": *virtual})}, notes...)
	} else if len(temperatures) == 0 {
		notes = append(notes, i18n.T(locale, "hardwareLib.noSensors", nil))
	}
	return HardwareReport{
		Temperatures: temperatures, Disks: disks, Pools: pools,
		ReportedAt: reportedAt, Virtualization: virtual, Notes: notes,
	}
}
