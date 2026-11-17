//go:build !windows

package main

// acquireInstance 保留其他平台既有启动行为；Windows 使用内核互斥量限制实例。
func acquireInstance() (func(), bool, error) {
	return func() {}, true, nil
}
