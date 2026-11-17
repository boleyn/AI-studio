// Command connector starts the desktop execution core with native approval dialogs.
// Installer/tray integration uses the same connector.Start entry point.
package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"log"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"

	"fastgpt.local/local-device/internal/connector"
	"fastgpt.local/local-device/internal/desktop"
)

var version = "development"

// devLoopback retains compatibility with the existing packaging flag.
var devLoopback string

func main() {
	desktop.ClientVersion = version
	if devLoopback == "1" {
		os.Setenv("LOCAL_DEVICE_DEV_LOOPBACK", "1")
	}
	testPlatform := flag.String("test-platform", "", "Test platform discovery and gateway access without connecting")
	showVersion := flag.Bool("version", false, "Show connector version and exit")
	origin := flag.String("platform", "", "Platform origin (HTTP or HTTPS)")
	gateway := flag.String("gateway", "", "Optional WS/WSS override; normally discovered from the platform")
	directory := flag.String("state-dir", "", "Private state directory (defaults to the user config directory)")
	name := flag.String("name", "", "Device display name (defaults to hostname)")
	shell := flag.String("shell", "", "Local shell: bash/sh, or powershell/cmd on Windows")
	flag.Parse()
	if *testPlatform != "" {
		ctx, cancel := context.WithTimeout(context.Background(), 12*time.Second)
		defer cancel()
		client, err := connector.NewPlatformClient(*testPlatform, nil)
		if err == nil {
			_, err = client.Discover(ctx)
		}
		if err != nil {
			fmt.Print(err.Error())
			os.Exit(1)
		}
		fmt.Print("ok")
		return
	}
	if *showVersion {
		fmt.Println(version)
		return
	}
	release, acquired, err := acquireInstance()
	if err != nil {
		log.Fatal("cannot acquire connector instance: ", err)
	}
	if !acquired {
		return
	}
	defer release()
	if err := registerLaunchProtocol(); err != nil {
		log.Print("connector: cannot register launch protocol: ", err)
	}
	if *directory == "" {
		config, err := os.UserConfigDir()
		if err != nil {
			log.Fatal("cannot resolve private configuration directory")
		}
		*directory = filepath.Join(config, "FastGPT", "local-device")
	}
	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()
	err = desktop.Run(ctx, connector.StartOptions{
		Origin: *origin, GatewayURL: *gateway, StateDirectory: *directory, Name: *name, Shell: *shell,
		Confirm: desktop.Confirm,
		Status:  func(value string) { log.Print("connector: ", value) },
	})
	if err != nil && !errors.Is(err, context.Canceled) {
		log.Fatal("connector stopped: ", err)
	}
}
