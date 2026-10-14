package files

import (
	"os"
	"path"
	"regexp"
	"sort"
	"strings"
)

// Temizlik asistanının HOST DOSYASI kalemleri (apt önbelleği, journald,
// döndürülmüş loglar). Docker kalemleri (sarkan imaj, kullanılmayan volume…)
// native ajanda YOK: K2 gereği Docker şekillendirmesi merkezde — merkez
// native sunucuda onları tünel üzerinden kendisi hesaplar ve buradakilerle
// birleştirir (src/lib/files/cleanup.ts). Panelin migration yedekleri de
// merkeze ait, burada yok.

// CleanupItem — merkezdeki CleanupItem (kind her zaman "path").
type CleanupItem struct {
	ID          string   `json:"id"`
	Label       string   `json:"label"`
	Description string   `json:"description"`
	Bytes       int64    `json:"bytes"`
	Count       int      `json:"count"`
	Risk        string   `json:"risk"`
	Kind        string   `json:"kind"`
	Paths       []string `json:"paths"`
}

type CleanupScan struct {
	Items      []CleanupItem `json:"items"`
	TotalBytes int64         `json:"totalBytes"`
}

type CleanupResult struct {
	OK             bool   `json:"ok"`
	Message        string `json:"message"`
	ReclaimedBytes int64  `json:"reclaimedBytes"`
}

func (f Fs) dirFiles(hostDir string, filter func(string) bool) (int64, int, []string) {
	var bytes int64
	var files []string
	entries, err := os.ReadDir(f.Real(hostDir))
	if err != nil {
		return 0, 0, nil
	}
	for _, entry := range entries {
		if !entry.Type().IsRegular() || (filter != nil && !filter(entry.Name())) {
			continue
		}
		info, err := entry.Info()
		if err != nil {
			continue
		}
		bytes += info.Size()
		files = append(files, path.Join(hostDir, entry.Name()))
	}
	return bytes, len(files), files
}

func (f Fs) treeBytes(hostDir string, depth int) (int64, int) {
	if depth > 6 {
		return 0, 0
	}
	entries, err := os.ReadDir(f.Real(hostDir))
	if err != nil {
		return 0, 0
	}
	var bytes int64
	count := 0
	for _, entry := range entries {
		full := path.Join(hostDir, entry.Name())
		if entry.IsDir() {
			b, c := f.treeBytes(full, depth+1)
			bytes, count = bytes+b, count+c
		} else if entry.Type().IsRegular() {
			if info, err := entry.Info(); err == nil {
				bytes += info.Size()
				count++
			}
		}
	}
	return bytes, count
}

var rotatedRe = regexp.MustCompile(`\.(gz|xz|bz2|old)$|\.\d+$`)

func (f Fs) rotatedLogs() (int64, int, []string) {
	var bytes int64
	var files []string
	var walk func(dir string, depth int)
	walk = func(dir string, depth int) {
		if depth > 3 {
			return
		}
		entries, err := os.ReadDir(f.Real(dir))
		if err != nil {
			return
		}
		for _, entry := range entries {
			full := path.Join(dir, entry.Name())
			if entry.IsDir() {
				// journald ikili arşivi ayrı bir kalem.
				if entry.Name() != "journal" {
					walk(full, depth+1)
				}
			} else if entry.Type().IsRegular() && rotatedRe.MatchString(entry.Name()) {
				if info, err := entry.Info(); err == nil {
					bytes += info.Size()
					files = append(files, full)
				}
			}
		}
	}
	walk("/var/log", 0)
	return bytes, len(files), files
}

// CleanupScan — files.cleanupScan (yalnız host dosyası kalemleri).
func (f Fs) CleanupScan() CleanupScan {
	items := []CleanupItem{}
	if bytes, count, files := f.dirFiles("/var/cache/apt/archives", func(name string) bool { return strings.HasSuffix(name, ".deb") }); bytes > 0 {
		items = append(items, CleanupItem{ID: "apt-cache", Label: f.T("cleanup.item.aptCache.label", nil),
			Description: f.T("cleanup.item.aptCache.description", nil), Bytes: bytes, Count: count, Risk: "safe", Kind: "path", Paths: files})
	}
	if bytes, count := f.treeBytes("/var/log/journal", 0); bytes > 0 {
		items = append(items, CleanupItem{ID: "journald", Label: f.T("cleanup.item.journald.label", nil),
			Description: f.T("cleanup.item.journald.description", nil), Bytes: bytes, Count: count, Risk: "destructive", Kind: "path", Paths: []string{}})
	}
	if bytes, count, files := f.rotatedLogs(); bytes > 0 {
		items = append(items, CleanupItem{ID: "rotated-logs", Label: f.T("cleanup.item.rotatedLogs.label", nil),
			Description: f.T("cleanup.item.rotatedLogs.description", nil), Bytes: bytes, Count: count, Risk: "safe", Kind: "path", Paths: files})
	}
	sort.SliceStable(items, func(i, j int) bool { return items[i].Bytes > items[j].Bytes })
	var total int64
	for _, item := range items {
		total += item.Bytes
	}
	return CleanupScan{Items: items, TotalBytes: total}
}

// CleanupRun — files.cleanupRun. Dosyalar üst klasöre göre gruplanır;
// silme `files.roots` denetiminden geçer (Node ile aynı).
func (f Fs) CleanupRun(itemID string, roots []string) CleanupResult {
	var item *CleanupItem
	for _, candidate := range f.CleanupScan().Items {
		if candidate.ID == itemID {
			c := candidate
			item = &c
		}
	}
	if item == nil {
		return CleanupResult{Message: f.T("cleanup.notInList", nil)}
	}
	if itemID == "journald" {
		return CleanupResult{Message: f.T("cleanup.journaldManual", nil)}
	}
	if len(item.Paths) == 0 {
		return CleanupResult{Message: f.T("cleanup.nothingToDelete", nil)}
	}
	byParent := map[string][]string{}
	var order []string
	var reclaimed int64
	for _, file := range item.Paths {
		if info, err := os.Stat(f.Real(file)); err == nil {
			reclaimed += info.Size()
		}
		parent := path.Dir(file)
		if _, seen := byParent[parent]; !seen {
			order = append(order, parent)
		}
		byParent[parent] = append(byParent[parent], path.Base(file))
	}
	var failures []string
	removed := 0
	for _, parent := range order {
		outcome := f.RemoveFilesIn(parent, roots, byParent[parent])
		if outcome.OK {
			removed += len(byParent[parent])
		} else {
			failures = append(failures, parent+": "+outcome.Message)
		}
	}
	message := f.T("cleanup.removedFiles", map[string]any{"count": removed})
	if len(failures) > 0 {
		if len(failures) > 2 {
			failures = failures[:2]
		}
		message += " " + f.T("cleanup.failedSome", map[string]any{"names": strings.Join(failures, " · ")})
		reclaimed = 0
	}
	return CleanupResult{OK: len(failures) == 0, Message: message, ReclaimedBytes: reclaimed}
}
