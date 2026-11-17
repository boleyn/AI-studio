package main

import (
	"os"

	"golang.org/x/sys/windows/registry"
)

// registerLaunchProtocol registers a per-user launch command for the current executable.
// The URL is deliberately omitted from the command. Invitations arrive through the local bridge.
func registerLaunchProtocol() error {
	executable, err := os.Executable()
	if err != nil {
		return err
	}
	key, _, err := registry.CreateKey(registry.CURRENT_USER, `Software\Classes\fastgpt-connector`, registry.SET_VALUE)
	if err != nil {
		return err
	}
	defer key.Close()
	if err := key.SetStringValue("", "URL:FastGPT Connector"); err != nil {
		return err
	}
	if err := key.SetStringValue("URL Protocol", ""); err != nil {
		return err
	}
	command, _, err := registry.CreateKey(registry.CURRENT_USER, `Software\Classes\fastgpt-connector\shell\open\command`, registry.SET_VALUE)
	if err != nil {
		return err
	}
	defer command.Close()
	return command.SetStringValue("", `"`+executable+`"`)
}
