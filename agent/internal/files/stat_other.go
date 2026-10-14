//go:build !linux

package files

import "os"

// Ajan Linux'ta çalışır; burası testlerin başka sistemlerde derlenmesi için.
func rawStat(info os.FileInfo) (mode uint32, uid, gid uint32) {
	return uint32(info.Mode().Perm()), 0, 0
}
