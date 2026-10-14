//go:build linux

package hostinfo

import "syscall"

// statfs — toplam, boş (rezerve dahil) ve kullanılabilir bayt (df ile aynı).
func statfs(path string) (total, free, avail uint64, err error) {
	var st syscall.Statfs_t
	if err = syscall.Statfs(path, &st); err != nil {
		return 0, 0, 0, err
	}
	bsize := uint64(st.Bsize)
	return uint64(st.Blocks) * bsize, uint64(st.Bfree) * bsize, uint64(st.Bavail) * bsize, nil
}
