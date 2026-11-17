package connector

import (
	"context"
	"errors"
	"fastgpt.local/local-device/internal/transport"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"runtime"

	"fastgpt.local/local-device/internal/devicekey"
	"fastgpt.local/local-device/internal/executor"
	"fastgpt.local/local-device/internal/grant"
	"fastgpt.local/local-device/internal/journal"
)

// BindingInvite is sent only after the local user confirms the account and team.
type BindingInvite struct {
	Code   string
	Access grant.AccountAccess
	Result chan<- error
}

type StartOptions struct {
	RePair             bool
	Secondary          bool
	AccountMode        bool
	InviteAccess       grant.AccountAccess
	InviteCode         string
	Origin             string
	GatewayURL         string
	StateDirectory     string
	Name               string
	Shell              string
	HTTPClient         *http.Client
	ShowPairing        func(PairingNotice) error
	ShowPairingContext func(context.Context, PairingNotice) error
	Confirm            func(context.Context, grant.Grant) (string, error)
	Ready              func(*LocalSession)
	Bound              func(string)
	BoundDevices       func([]string)
	Removed            func(string)
	Invites            <-chan BindingInvite
	Status             func(string)
}

// Start owns the connector's key, journal and network lifetime. All local approvals
// remain explicit UI callbacks; configuration is checked before creating an identity.
// Shutdown waits for active native processes to stop before releasing the journal lock.
func Start(ctx context.Context, input StartOptions) error {
	if (!input.Secondary && input.ShowPairing == nil && input.ShowPairingContext == nil) || input.Confirm == nil || !filepath.IsAbs(input.StateDirectory) {
		return errors.New("invalid_start_configuration")
	}
	platform, err := NewPlatformClient(input.Origin, input.HTTPClient)
	if err != nil {
		return err
	}
	kind := input.Shell
	if kind == "" {
		kind = "bash"
		if runtime.GOOS == "windows" {
			kind = "powershell"
		}
	}
	shell, err := executor.ResolveShell(kind)
	if err != nil {
		return err
	}
	name := input.Name
	if name == "" {
		name, err = os.Hostname()
	}
	if err != nil || name == "" {
		return errors.New("device_name_required")
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	if input.GatewayURL == "" {
		input.GatewayURL, err = platform.Discover(ctx)
		if err != nil {
			return err
		}
	}
	address, err := url.Parse(input.GatewayURL)
	if err != nil || !transport.SecureURL(address, "wss", "ws") || address.Host == "" || address.User != nil || address.RawQuery != "" || address.Fragment != "" {
		return errors.New("invalid_gateway_address")
	}
	ledger, err := journal.Open(input.StateDirectory)
	if err != nil {
		return err
	}
	defer ledger.Close()
	key, err := devicekey.LoadOrCreate(input.StateDirectory, input.Origin)
	if err != nil {
		return err
	}
	defer clear(key)
	if input.RePair {
		if err := ledger.ForgetBinding(ctx, input.Origin); err != nil {
			return err
		}
	}
	return platform.runBindings(ctx, input, PairingOptions{
		InviteCode: input.InviteCode, Journal: ledger, Key: key, Name: name,
		Platform: runtime.GOOS, Show: input.ShowPairing, ShowContext: input.ShowPairingContext,
	}, shell)
}
