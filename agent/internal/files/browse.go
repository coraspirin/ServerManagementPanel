package files

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"os"
	"path"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

// FileEntry — merkezdeki FileEntry (alan sırası aynı).
type FileEntry struct {
	Name       string  `json:"name"`
	Path       string  `json:"path"`
	Kind       string  `json:"kind"` // file | dir | symlink | other
	SizeBytes  int64   `json:"sizeBytes"`
	ModifiedAt int64   `json:"modifiedAt"`
	ModeText   string  `json:"modeText"`
	ModeOctal  string  `json:"modeOctal"`
	UID        uint32  `json:"uid"`
	GID        uint32  `json:"gid"`
	LinkTarget *string `json:"linkTarget"`
}

// Listing — merkezdeki Listing.
type Listing struct {
	Path         string      `json:"path"`
	Parent       *string     `json:"parent"`
	Entries      []FileEntry `json:"entries"`
	Truncated    bool        `json:"truncated"`
	TotalEntries int         `json:"totalEntries"`
}

const maxEntries = 2000

func modeText(mode uint32) string {
	const bits = "rwxrwxrwx"
	var out strings.Builder
	for i := 0; i < 9; i++ {
		if mode&(1<<(8-i)) != 0 {
			out.WriteByte(bits[i])
		} else {
			out.WriteByte('-')
		}
	}
	return out.String()
}

func modeOctal(mode uint32) string {
	return fmt.Sprintf("%04o", mode&0o7777)
}

func kindOf(info os.FileInfo) string {
	switch {
	case info.Mode()&os.ModeSymlink != 0:
		return "symlink"
	case info.IsDir():
		return "dir"
	case info.Mode().IsRegular():
		return "file"
	default:
		return "other"
	}
}

// lessName — ad sırası. Node `localeCompare(…, "tr")`; burada küçük harfe
// indirgenmiş karşılaştırma (Türkçe harfler bayt sırasında kalır — klasör
// önce kuralı ve büyük/küçük harf duyarsızlığı korunur).
func lessName(a, b string) bool {
	la, lb := strings.ToLower(a), strings.ToLower(b)
	if la != lb {
		return la < lb
	}
	return a < b
}

func parentOf(hostPath string) *string {
	if hostPath == "/" {
		return nil
	}
	parent := path.Dir(hostPath)
	return &parent
}

// List — files.list.
func (f Fs) List(raw string, roots []string) (*Listing, error) {
	hostPath, real, err := f.Follow(raw, roots)
	if err != nil {
		return nil, err
	}
	dirents, err := os.ReadDir(real)
	if err != nil {
		return nil, err
	}
	total := len(dirents)
	sort.SliceStable(dirents, func(i, j int) bool {
		di, dj := dirents[i].IsDir(), dirents[j].IsDir()
		if di != dj {
			return di
		}
		return lessName(dirents[i].Name(), dirents[j].Name())
	})
	if len(dirents) > maxEntries {
		dirents = dirents[:maxEntries]
	}
	entries := make([]FileEntry, 0, len(dirents))
	for _, dirent := range dirents {
		full := filepath.Join(real, dirent.Name())
		// Lstat: bağın kendisi; kırık bağ listeyi düşürmesin.
		info, err := os.Lstat(full)
		if err != nil {
			continue
		}
		var link *string
		if info.Mode()&os.ModeSymlink != 0 {
			if target, err := os.Readlink(full); err == nil {
				link = &target
			}
		}
		mode, uid, gid := rawStat(info)
		entries = append(entries, FileEntry{
			Name: dirent.Name(), Path: path.Join(hostPath, dirent.Name()), Kind: kindOf(info),
			SizeBytes: info.Size(), ModifiedAt: info.ModTime().Unix(),
			ModeText: modeText(mode), ModeOctal: modeOctal(mode), UID: uid, GID: gid, LinkTarget: link,
		})
	}
	return &Listing{Path: hostPath, Parent: parentOf(hostPath), Entries: entries, Truncated: total > maxEntries, TotalEntries: total}, nil
}

// FileContent — merkezdeki FileContent.
type FileContent struct {
	Path      string `json:"path"`
	Content   string `json:"content"`
	SizeBytes int64  `json:"sizeBytes"`
	Truncated bool   `json:"truncated"`
	Binary    bool   `json:"binary"`
}

func (f Fs) readable(hostPath, real string) bool {
	return ContentReadable(hostPath) && ContentReadable(f.toHost(real))
}

// Read — files.read. İlk 8 KB'de NUL varsa ikili sayılır (içerik gönderilmez).
func (f Fs) Read(raw string, roots []string, maxBytes int64) (*FileContent, error) {
	hostPath, real, err := f.Follow(raw, roots)
	if err != nil {
		return nil, err
	}
	if !f.readable(hostPath, real) {
		return nil, f.fail("browse.secretContent", nil)
	}
	info, err := os.Stat(real)
	if err != nil {
		return nil, err
	}
	if !info.Mode().IsRegular() {
		return nil, f.fail("browse.notFile", nil)
	}
	file, err := os.Open(real)
	if err != nil {
		return nil, err
	}
	defer file.Close()
	limit := maxBytes
	if limit < 8192 {
		limit = 8192
	}
	data, err := io.ReadAll(io.LimitReader(file, limit))
	if err != nil {
		return nil, err
	}
	head := data
	if len(head) > 8192 {
		head = head[:8192]
	}
	if bytes.IndexByte(head, 0) >= 0 {
		return &FileContent{Path: hostPath, SizeBytes: info.Size(), Binary: true}, nil
	}
	if int64(len(data)) > maxBytes {
		data = data[:maxBytes]
	}
	return &FileContent{
		Path: hostPath, Content: strings.ToValidUTF8(string(data), "�"),
		SizeBytes: info.Size(), Truncated: info.Size() > maxBytes,
	}, nil
}

// DownloadHead — files.download ilk çerçevesi.
type DownloadHead struct {
	Name      string `json:"name"`
	SizeBytes int64  `json:"sizeBytes"`
}

// Download — files.download: ilk çerçeve ad + boyut, sonra parçalar.
func (f Fs) Download(ctx context.Context, raw string, roots []string, emit func(any) error, chunk func([]byte) any) error {
	hostPath, real, err := f.Follow(raw, roots)
	if err != nil {
		return err
	}
	if !f.readable(hostPath, real) {
		return f.fail("browse.secretDownload", nil)
	}
	info, err := os.Stat(real)
	if err != nil {
		return err
	}
	if !info.Mode().IsRegular() {
		return f.fail("browse.onlyFiles", nil)
	}
	file, err := os.Open(real)
	if err != nil {
		return err
	}
	defer file.Close()
	if err := emit(DownloadHead{Name: path.Base(hostPath), SizeBytes: info.Size()}); err != nil {
		return err
	}
	buf := make([]byte, 64*1024)
	for ctx.Err() == nil {
		n, err := file.Read(buf)
		if n > 0 {
			if emitErr := emit(chunk(append([]byte(nil), buf[:n]...))); emitErr != nil {
				return emitErr
			}
		}
		if err == io.EOF {
			return nil
		}
		if err != nil {
			return err
		}
	}
	return nil
}

// UsageEntry / Usage — files.usage.
type UsageEntry struct {
	Path  string `json:"path"`
	Name  string `json:"name"`
	Bytes int64  `json:"bytes"`
	IsDir bool   `json:"isDir"`
}

type Usage struct {
	Path       string       `json:"path"`
	Entries    []UsageEntry `json:"entries"`
	TotalBytes int64        `json:"totalBytes"`
	TimedOut   bool         `json:"timedOut"`
}

// Usage — özyinelemeli boyut; süre ve derinlik sınırlı, bağlar izlenmez.
func (f Fs) Usage(raw string, roots []string, budget time.Duration) (*Usage, error) {
	hostPath, real, err := f.Follow(raw, roots)
	if err != nil {
		return nil, err
	}
	deadline := time.Now().Add(budget)
	timedOut := false
	var sizeOf func(target string, depth int) int64
	sizeOf = func(target string, depth int) int64 {
		if time.Now().After(deadline) {
			timedOut = true
			return 0
		}
		info, err := os.Lstat(target)
		if err != nil || info.Mode()&os.ModeSymlink != 0 {
			return 0
		}
		if !info.IsDir() {
			return info.Size()
		}
		if depth > 12 {
			return 0
		}
		children, _ := os.ReadDir(target)
		var total int64
		for _, child := range children {
			total += sizeOf(filepath.Join(target, child.Name()), depth+1)
			if time.Now().After(deadline) {
				timedOut = true
				break
			}
		}
		return total
	}
	dirents, err := os.ReadDir(real)
	if err != nil {
		return nil, err
	}
	entries := []UsageEntry{}
	for _, dirent := range dirents {
		entries = append(entries, UsageEntry{
			Path: path.Join(hostPath, dirent.Name()), Name: dirent.Name(),
			Bytes: sizeOf(filepath.Join(real, dirent.Name()), 0), IsDir: dirent.IsDir(),
		})
		if time.Now().After(deadline) {
			timedOut = true
			break
		}
	}
	sort.SliceStable(entries, func(i, j int) bool { return entries[i].Bytes > entries[j].Bytes })
	var total int64
	for _, entry := range entries {
		total += entry.Bytes
	}
	if len(entries) > 100 {
		entries = entries[:100]
	}
	return &Usage{Path: hostPath, Entries: entries, TotalBytes: total, TimedOut: timedOut}, nil
}
