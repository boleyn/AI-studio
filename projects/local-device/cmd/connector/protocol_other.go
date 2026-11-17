//go:build !windows

package main

// macOS registers the launch protocol through Info.plist.
func registerLaunchProtocol() error { return nil }
