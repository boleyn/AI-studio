package connector

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"testing"

	"fastgpt.local/local-device/internal/grant"
)

func TestStartRejectsBeforeIdentityCreation(t *testing.T) {
	for _, field := range []string{"pairing", "confirmation", "directory", "gateway", "origin", "shell", "cancelled"} {
		t.Run(field, func(t *testing.T) {
			dir := filepath.Join(t.TempDir(), "not-created")
			input := StartOptions{Origin: "https://platform.example", GatewayURL: "wss://gateway.example/connect", StateDirectory: dir,
				ShowPairing: func(PairingNotice) error { t.Fatal("unexpected pairing"); return nil },
				Confirm:     func(context.Context, grant.Grant) (string, error) { t.Fatal("unexpected approval"); return "", nil },
			}
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			switch field {
			case "pairing":
				input.ShowPairing = nil
			case "confirmation":
				input.Confirm = nil
			case "directory":
				input.StateDirectory = "relative"
			case "gateway":
				input.GatewayURL = "ftp://gateway.example/connect"
			case "origin":
				input.Origin = "ftp://platform.example"
			case "shell":
				input.Shell = "unsupported"
			case "cancelled":
				if runtime.GOOS == "windows" {
					input.Shell = "powershell"
				}
				cancel()
			}
			if err := Start(ctx, input); err == nil {
				t.Fatal("invalid startup accepted")
			}
			if _, err := os.Stat(dir); !errors.Is(err, os.ErrNotExist) {
				t.Fatalf("created identity state before validation: %v", err)
			}
		})
	}
}
