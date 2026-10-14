//go:build linux

package files

import (
	"os"
	"syscall"
)

// rawStat — Unix izin bitleri (setuid/setgid/sticky dahil, `mode & 0o7777`
// ile Node'daki gibi), sahip uid/gid.
func rawStat(info os.FileInfo) (mode uint32, uid, gid uint32) {
	if st, ok := info.Sys().(*syscall.Stat_t); ok {
		return uint32(st.Mode), st.Uid, st.Gid
	}
	return uint32(info.Mode().Perm()), 0, 0
}
