//go:build !linux

package hostinfo

import "errors"

// Ajan yalnız Linux'ta çalışır; bu dosya testlerin başka işletim
// sistemlerinde derlenebilmesi için.
func statfs(string) (uint64, uint64, uint64, error) {
	return 0, 0, 0, errors.New("statfs yalnız linux")
}
