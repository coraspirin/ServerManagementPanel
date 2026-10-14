package hostinfo

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// Sahte host: /proc, /sys ve / ağacı geçici dizinde. Değerler Raspberry Pi
// 2B (armv7, DietPi) ve x86 sunucudan alınmış örneklere dayanıyor.

func write(t *testing.T, root, rel, content string) {
	t.Helper()
	path := filepath.Join(root, filepath.FromSlash(rel))
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
}

const piCPUInfo = `processor	: 0
model name	: ARMv7 Processor rev 5 (v7l)
BogoMIPS	: 38.40

processor	: 1
model name	: ARMv7 Processor rev 5 (v7l)

processor	: 2
model name	: ARMv7 Processor rev 5 (v7l)

processor	: 3
model name	: ARMv7 Processor rev 5 (v7l)

Hardware	: BCM2835
Model		: Raspberry Pi 2 Model B Rev 1.1
`

const meminfo = `MemTotal:         944268 kB
MemFree:          120000 kB
MemAvailable:     472134 kB
SwapTotal:        102396 kB
SwapFree:          51198 kB
`

const mounts = `/dev/mmcblk0p2 / ext4 rw,noatime 0 0
proc /proc proc rw 0 0
tmpfs /run tmpfs rw 0 0
/dev/mmcblk0p1 /boot vfat rw 0 0
/dev/mmcblk0p2 /mnt/bind\040root ext4 rw 0 0
overlay /var/lib/docker/overlay2/x/merged overlay rw 0 0
/dev/sda1 /mnt/veri ext4 rw 0 0
/dev/loop0 /snap/core/1 squashfs ro 0 0
`

const netdev = `Inter-|   Receive                                                |  Transmit
 face |bytes    packets errs drop fifo frame compressed multicast|bytes    packets errs drop fifo colls carrier compressed
    lo:  1000      10    0    0    0     0          0         0     1000      10    0    0    0     0       0          0
  eth0: %d     100    0    0    0     0          0         0    %d     100    0    0    0     0       0          0
veth12: 999999     100    0    0    0     0          0         0    999999     100    0    0    0     0       0          0
`

func fakeHost(t *testing.T) Roots {
	root := t.TempDir()
	r := Roots{Proc: filepath.Join(root, "proc"), Sys: filepath.Join(root, "sys"), Root: filepath.Join(root, "root")}
	write(t, root, "proc/cpuinfo", piCPUInfo)
	write(t, root, "proc/meminfo", meminfo)
	write(t, root, "proc/uptime", "12345.67 40000.00\n")
	write(t, root, "proc/loadavg", "0.52 0.40 0.31 1/123 4567\n")
	write(t, root, "proc/sys/kernel/osrelease", "6.12.25+rpt-rpi-v7\n")
	write(t, root, "proc/stat", "cpu  100 0 100 700 100 0 0 0 0 0\ncpu0 1 2 3 4 5\n")
	write(t, root, "proc/mounts", mounts)
	write(t, root, "proc/net/dev", strings.Replace(strings.Replace(netdev, "%d", "1000", 1), "%d", "2000", 1))
	write(t, root, "sys/class/net/eth0/device/uevent", "")
	write(t, root, "sys/class/net/veth12/address", "")
	write(t, root, "root/etc/hostname", "DietPi\n")
	write(t, root, "root/etc/os-release", "NAME=\"Debian GNU/Linux\"\nPRETTY_NAME=\"Debian GNU/Linux 12 (bookworm)\"\n")
	return r
}

func TestSistemBilgisi(t *testing.T) {
	info := fakeHost(t).Info()
	if info.Hostname != "DietPi" || info.OsName == nil || *info.OsName != "Debian GNU/Linux 12 (bookworm)" {
		t.Fatalf("ad/os: %+v", info)
	}
	if info.CPUModel != "ARMv7 Processor rev 5 (v7l)" || info.CPUCount != 4 {
		t.Fatalf("cpu: %q × %d", info.CPUModel, info.CPUCount)
	}
	if info.TotalMemBytes != 944268*1024 || info.UptimeSeconds != 12346 || info.Release != "6.12.25+rpt-rpi-v7" {
		t.Fatalf("bellek/süre/çekirdek: %+v", info)
	}
	// Merkez Node adlarını bekliyor.
	if NodeArch("amd64") != "x64" || NodeArch("arm") != "arm" || NodeArch("arm64") != "arm64" || NodeArch("386") != "ia32" {
		t.Fatal("mimari adları")
	}
	// JSON alan adları providers/types.ts SystemInfo ile aynı.
	data, _ := json.Marshal(info)
	for _, key := range []string{"hostname", "platform", "release", "osName", "arch", "cpuModel", "cpuCount", "totalMemBytes", "uptimeSeconds"} {
		if !strings.Contains(string(data), `"`+key+`"`) {
			t.Errorf("%s alanı yok: %s", key, data)
		}
	}
}

func TestBagliBolumler(t *testing.T) {
	got := ParseMounts(mounts)
	want := []string{"/", "/boot", "/mnt/veri"}
	if strings.Join(got, ",") != strings.Join(want, ",") {
		t.Fatalf("bölümler %v ≠ %v", got, want)
	}
}

func metricMap(samples []MetricSample) map[string]float64 {
	out := map[string]float64{}
	for _, s := range samples {
		key := s.Metric
		if s.Label != "" {
			key += "@" + s.Label
		}
		out[key] = s.Value
	}
	return out
}

func TestMetrikler(t *testing.T) {
	r := fakeHost(t)
	now := time.Unix(1_800_000_000, 0)
	sampler := NewSampler(r)
	sampler.Now = func() time.Time { return now }
	sampler.Statfs = func(path string) (uint64, uint64, uint64, error) {
		switch path {
		case r.Root:
			return 30_000, 10_000, 8_000, nil // used 20000, avail 8000 → %71.43
		case filepath.Join(r.Root, "/mnt/veri"):
			return 1_000, 1_000, 900, nil
		}
		return 0, 0, 0, errors.New("yok")
	}

	// İlk çağrı: oran metrikleri yok (CPU %, ağ).
	first := metricMap(sampler.Sample(MetricSettings{}))
	if _, ok := first["cpu.pct"]; ok {
		t.Fatal("ilk çağrıda cpu.pct olmamalı")
	}
	if _, ok := first["net.rx_bps@eth0"]; ok {
		t.Fatal("ilk çağrıda ağ hızı olmamalı")
	}
	if first["mem.total"] != 944268*1024 || first["mem.used"] != (944268-472134)*1024 || first["mem.used_pct"] != 50 {
		t.Fatalf("bellek: %v", first)
	}
	if first["swap.used_pct"] != 50 || first["load.1m"] != 0.52 || first["uptime.seconds"] != 12345.67 {
		t.Fatalf("swap/yük/süre: %v", first)
	}
	if first["disk.used_pct@/"] != 71.43 || first["disk.free@/"] != 8000 || first["disk.used@/mnt/veri"] != 0 {
		t.Fatalf("disk: %v", first)
	}
	if _, ok := first["disk.total@/boot"]; ok {
		t.Fatal("statfs hatası veren bölüm atlanmalı")
	}

	// İkinci çağrı: 10 sn sonra, CPU ve ağ sayaçları ilerlemiş.
	write(t, filepath.Dir(r.Proc), "proc/stat", "cpu  150 0 150 750 150 0 0 0 0 0\n")
	write(t, filepath.Dir(r.Proc), "proc/net/dev", strings.Replace(strings.Replace(netdev, "%d", "11000", 1), "%d", "7000", 1))
	now = now.Add(10 * time.Second)
	second := metricMap(sampler.Sample(MetricSettings{}))
	// toplam fark 200; boşta (idle+iowait) 100 → %50; iowait 50/200 → %25.
	if second["cpu.pct"] != 50 || second["cpu.iowait_pct"] != 25 {
		t.Fatalf("cpu: %v", second)
	}
	if second["net.rx_bps@eth0"] != 1000 || second["net.tx_bps@eth0"] != 500 {
		t.Fatalf("ağ: %v", second)
	}
	if _, ok := second["net.rx_bps@veth12"]; ok {
		t.Fatal("fiziksel olmayan arayüz seçilmemeli")
	}

	// Ayarla seçilen arayüz ve disk.
	third := metricMap(sampler.Sample(MetricSettingsFrom(map[string]any{
		"monitoring.disks": " /mnt/veri ", "monitoring.net_interfaces": "veth12",
	})))
	if _, ok := third["disk.total@/"]; ok {
		t.Fatal("ayardaki disk listesi otomatik seçimi ezmeli")
	}
	if _, ok := third["disk.total@/mnt/veri"]; !ok {
		t.Fatalf("ayardaki disk: %v", third)
	}
}

func TestMdstat(t *testing.T) {
	content := `Personalities : [raid1]
md0 : active raid1 sdb1[1] sda1[0]
      976630464 blocks super 1.2 [2/2] [UU]

md1 : active raid1 sdd1[2](F) sdc1[0]
      976630464 blocks super 1.2 [2/1] [U_]
      [==>..................]  recovery = 12.6% (123/456) finish=10min
`
	pools := ParseMdstat(content, "tr")
	if len(pools) != 2 {
		t.Fatalf("%d havuz", len(pools))
	}
	if !pools[0].Healthy || pools[0].State != "active" || pools[0].Detail != "raid1 · 2/2 disk etkin [UU]" {
		t.Fatalf("md0: %+v", pools[0])
	}
	if pools[1].Healthy || pools[1].State != "recovery (12.6%)" || pools[1].Devices[0].State != "arızalı" {
		t.Fatalf("md1: %+v", pools[1])
	}
	if ParseMdstat(content, "en")[1].Devices[0].State != "failed" {
		t.Fatal("dil ayarı uygulanmadı")
	}
}

func TestDonanim(t *testing.T) {
	r := fakeHost(t)
	base := filepath.Dir(r.Proc)
	write(t, base, "sys/class/hwmon/hwmon0/name", "cpu_thermal\n")
	write(t, base, "sys/class/hwmon/hwmon0/temp1_input", "48312\n")
	write(t, base, "sys/class/hwmon/hwmon0/temp1_crit", "110000\n")
	write(t, base, "sys/class/hwmon/hwmon0/temp2_input", "0\n") // bağlı olmayan kanal
	reports := filepath.Join(base, "reports")
	write(t, base, "reports/hardware.json", `{"generatedAt":1800000000,"disks":[{"device":"/dev/sda","health":"PASSED"}],"pools":[],"errors":["smartctl yok: /dev/sdb"]}`)

	report := r.Hardware(reports, map[string]any{"general.language": "tr"})
	if len(report.Temperatures) != 1 {
		t.Fatalf("sıcaklık: %+v", report.Temperatures)
	}
	temp := report.Temperatures[0]
	if temp.ID != "cpu_thermal/temp1" || temp.Celsius != 48.3 || temp.Label != "sensör 1" || temp.CriticalC == nil || *temp.CriticalC != 110 || temp.HighC != nil {
		t.Fatalf("sensör: %+v", temp)
	}
	if len(report.Disks) != 1 || report.ReportedAt == nil || *report.ReportedAt != 1_800_000_000 {
		t.Fatalf("rapor: %+v", report)
	}
	if len(report.Notes) != 1 || report.Notes[0] != "Host raporu: smartctl yok: /dev/sdb" {
		t.Fatalf("notlar: %v", report.Notes)
	}

	// Rapor yok + sanal makine + sensör yok → açıklama en üstte.
	empty := fakeHost(t)
	write(t, filepath.Dir(empty.Proc), "sys/class/dmi/id/sys_vendor", "QEMU\n")
	write(t, filepath.Dir(empty.Proc), "sys/class/hwmon/.keep", "")
	bare := empty.Hardware(filepath.Join(filepath.Dir(empty.Proc), "reports"), nil)
	if bare.Virtualization == nil || *bare.Virtualization != "QEMU/KVM sanal makinesi" {
		t.Fatalf("sanallaştırma: %v", bare.Virtualization)
	}
	if !strings.HasPrefix(bare.Notes[0], "Sunucu QEMU/KVM sanal makinesi olarak") || !strings.Contains(bare.Notes[1], "S.M.A.R.T") {
		t.Fatalf("notlar: %v", bare.Notes)
	}
	data, _ := json.Marshal(bare)
	if !strings.Contains(string(data), `"disks":[]`) || !strings.Contains(string(data), `"pools":[]`) || !strings.Contains(string(data), `"temperatures":[]`) {
		t.Fatalf("boş diziler null olmamalı: %s", data)
	}
}
