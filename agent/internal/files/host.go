package files

import (
	"encoding/json"
	"errors"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"
)

// --- host.listDirs / host.dirExists (ayarlardaki klasör seçici) -----------
//
// Kök kısıtı YOK (seçici izinli kök listesinin kendisini yapılandırıyor);
// sınırlar: yasak yollar, yalnız KLASÖR adları, uç merkezde `settings.edit`.

type DirEntry struct {
	Name string `json:"name"`
	Path string `json:"path"`
}

type DirListing struct {
	Path   string     `json:"path"`
	Parent *string    `json:"parent"`
	Dirs   []DirEntry `json:"dirs"`
	Error  *string    `json:"error"`
}

const maxDirs = 1000

func pickerPath(raw string) string {
	input := strings.TrimSpace(raw)
	if input == "" || !strings.HasPrefix(input, "/") {
		return "/"
	}
	return Normalize(input)
}

// ListDirs — host.listDirs.
func (f Fs) ListDirs(raw string) DirListing {
	hostPath := pickerPath(raw)
	listing := DirListing{Path: hostPath, Parent: parentOf(hostPath), Dirs: []DirEntry{}}
	fail := func(key string) DirListing {
		message := f.T(key, nil)
		listing.Error = &message
		return listing
	}
	if strings.Contains(hostPath, "\x00") || ForbiddenPath(hostPath) {
		return fail("dirs.forbidden")
	}
	entries, err := os.ReadDir(f.Real(hostPath))
	if err != nil {
		switch {
		case errors.Is(err, os.ErrNotExist):
			return fail("dirs.notFound")
		case isNotDir(err):
			return fail("dirs.notDir")
		default:
			return fail("dirs.unreadable")
		}
	}
	for _, entry := range entries {
		// Klasöre giden bağlar da seçilebilsin (Node readdir isDirectory
		// bağı saymaz; burada yalnız gerçek klasörler — aynı davranış).
		if !entry.IsDir() {
			continue
		}
		full := path.Join(hostPath, entry.Name())
		if ForbiddenPath(full) {
			continue
		}
		listing.Dirs = append(listing.Dirs, DirEntry{Name: entry.Name(), Path: full})
	}
	sort.SliceStable(listing.Dirs, func(i, j int) bool { return lessName(listing.Dirs[i].Name, listing.Dirs[j].Name) })
	if len(listing.Dirs) > maxDirs {
		listing.Dirs = listing.Dirs[:maxDirs]
	}
	return listing
}

func isNotDir(err error) bool {
	return strings.Contains(err.Error(), "not a directory")
}

// DirExists — host.dirExists (bağ değil, gerçek klasör).
func (f Fs) DirExists(raw string) bool {
	hostPath := pickerPath(raw)
	if ForbiddenPath(hostPath) {
		return false
	}
	info, err := os.Lstat(f.Real(hostPath))
	return err == nil && info.IsDir()
}

// --- host.accounts --------------------------------------------------------

type HostUser struct {
	Name    string `json:"name"`
	UID     int    `json:"uid"`
	GID     int    `json:"gid"`
	Comment string `json:"comment"`
	Shell   string `json:"shell"`
	Human   bool   `json:"human"`
}

type HostGroup struct {
	Name string `json:"name"`
	GID  int    `json:"gid"`
}

type HostAccounts struct {
	Users  []HostUser  `json:"users"`
	Groups []HostGroup `json:"groups"`
	Error  *string     `json:"error"`
}

var nologinRe = regexp.MustCompile(`(nologin|/false)$`)

func skipLine(line string) bool {
	return line == "" || strings.HasPrefix(line, "#") || strings.HasPrefix(line, "+") || strings.HasPrefix(line, "-")
}

// ParsePasswd — insan hesapları önce, sonra uid sırası. /etc/shadow okunmaz.
func ParsePasswd(text string) []HostUser {
	users := []HostUser{}
	for _, line := range strings.Split(text, "\n") {
		line = strings.TrimRight(line, "\r")
		if skipLine(line) {
			continue
		}
		parts := strings.Split(line, ":")
		for len(parts) < 7 {
			parts = append(parts, "")
		}
		uid, err1 := strconv.Atoi(parts[2])
		gid, err2 := strconv.Atoi(parts[3])
		if parts[0] == "" || err1 != nil || err2 != nil {
			continue
		}
		comment, _, _ := strings.Cut(parts[4], ",")
		users = append(users, HostUser{
			Name: parts[0], UID: uid, GID: gid, Comment: comment, Shell: parts[6],
			Human: uid == 0 || (uid >= 1000 && uid < 65534 && !nologinRe.MatchString(parts[6])),
		})
	}
	sort.SliceStable(users, func(i, j int) bool {
		if users[i].Human != users[j].Human {
			return users[i].Human
		}
		return users[i].UID < users[j].UID
	})
	return users
}

func ParseGroup(text string) []HostGroup {
	groups := []HostGroup{}
	for _, line := range strings.Split(text, "\n") {
		line = strings.TrimRight(line, "\r")
		if skipLine(line) {
			continue
		}
		parts := strings.Split(line, ":")
		if len(parts) < 3 || parts[0] == "" {
			continue
		}
		gid, err := strconv.Atoi(parts[2])
		if err != nil {
			continue
		}
		groups = append(groups, HostGroup{Name: parts[0], GID: gid})
	}
	sort.SliceStable(groups, func(i, j int) bool { return groups[i].GID < groups[j].GID })
	return groups
}

// Accounts — host.accounts.
func (f Fs) Accounts() HostAccounts {
	passwd, err := os.ReadFile(f.Real("/etc/passwd"))
	if err != nil {
		message := f.T("hostUsers.unreadable", map[string]any{"path": "/etc/passwd"})
		return HostAccounts{Users: []HostUser{}, Groups: []HostGroup{}, Error: &message}
	}
	group, _ := os.ReadFile(f.Real("/etc/group"))
	return HostAccounts{Users: ParsePasswd(string(passwd)), Groups: ParseGroup(string(group))}
}

// --- updates.osReport -----------------------------------------------------

type OsPackage struct {
	Name      string  `json:"name"`
	Current   *string `json:"current"`
	Candidate string  `json:"candidate"`
	Security  bool    `json:"security"`
}

type OsUpdateReport struct {
	Available      bool        `json:"available"`
	ReportedAt     *float64    `json:"reportedAt"`
	Total          float64     `json:"total"`
	Security       float64     `json:"security"`
	RebootRequired bool        `json:"rebootRequired"`
	Packages       []OsPackage `json:"packages"`
	Errors         []string    `json:"errors"`
	Stale          bool        `json:"stale"`
}

// OsReport — host'taki scripts/os-updates.sh'ın raporu (yoksa "kurulmamış").
func OsReport(reportsDir string, staleHours float64, now time.Time) OsUpdateReport {
	empty := OsUpdateReport{Packages: []OsPackage{}, Errors: []string{}}
	data, err := os.ReadFile(filepath.Join(reportsDir, "os-updates.json"))
	if err != nil {
		return empty
	}
	var raw struct {
		ReportedAt     *float64    `json:"reportedAt"`
		Total          float64     `json:"total"`
		Security       float64     `json:"security"`
		RebootRequired bool        `json:"rebootRequired"`
		Packages       []OsPackage `json:"packages"`
		Errors         []string    `json:"errors"`
	}
	if json.Unmarshal(data, &raw) != nil {
		return empty
	}
	if raw.Packages == nil {
		raw.Packages = []OsPackage{}
	}
	if raw.Errors == nil {
		raw.Errors = []string{}
	}
	stale := raw.ReportedAt == nil || float64(now.Unix())-*raw.ReportedAt > staleHours*3600
	return OsUpdateReport{
		Available: true, ReportedAt: raw.ReportedAt, Total: raw.Total, Security: raw.Security,
		RebootRequired: raw.RebootRequired, Packages: raw.Packages, Errors: raw.Errors, Stale: stale,
	}
}

// --- backup.scanDir -------------------------------------------------------

type WatchDirScan struct {
	NewestAt   *int64  `json:"newestAt"`
	NewestName *string `json:"newestName"`
	FileCount  int     `json:"fileCount"`
	TotalBytes int64   `json:"totalBytes"`
	Error      *string `json:"error"`
}

// ScanWatchDir — izlenen yedek klasörünün en yeni girdisi (alt klasörlere inilmez).
func (f Fs) ScanWatchDir(dir string) WatchDirScan {
	scan := WatchDirScan{}
	real := dir
	if strings.HasPrefix(dir, "/") {
		real = f.Real(Normalize(dir))
	}
	entries, err := os.ReadDir(real)
	if err != nil {
		message := err.Error()
		if errors.Is(err, os.ErrNotExist) {
			message = f.T("backupWatch.notFound", map[string]any{"dir": dir, "root": "/"})
		}
		scan.Error = &message
		return scan
	}
	for _, entry := range entries {
		if !entry.Type().IsRegular() && !entry.IsDir() {
			continue
		}
		info, err := os.Stat(filepath.Join(real, entry.Name()))
		if err != nil {
			continue
		}
		mtime := info.ModTime().Unix()
		if entry.Type().IsRegular() {
			scan.FileCount++
			scan.TotalBytes += info.Size()
		}
		if scan.NewestAt == nil || mtime > *scan.NewestAt {
			name := entry.Name()
			scan.NewestAt, scan.NewestName = &mtime, &name
		}
	}
	return scan
}
