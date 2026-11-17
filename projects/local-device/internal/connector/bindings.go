package connector

import (
	"context"
	"encoding/json"
	"errors"
	"sync"
	"time"

	"fastgpt.local/local-device/internal/executor"
	"fastgpt.local/local-device/internal/grant"
)

// runBindings keeps one authenticated connection and one execution scope per
// account association. All workers finish before the shared journal is closed.
func (p *PlatformClient) runBindings(parent context.Context, input StartOptions, pairing PairingOptions, shell executor.Shell) error {
	ctx, cancel := context.WithCancel(parent)
	var workers sync.WaitGroup
	defer func() {
		cancel()
		workers.Wait()
	}()

	// Persist the explicit account decision before allowing its worker to connect.
	bind := func(bindCtx context.Context, code string, access grant.AccountAccess) (string, error) {
		options := pairing
		options.InviteCode = code
		id, err := p.EnsureBinding(bindCtx, options)
		if err != nil || code == "" || access.Workdir == "" {
			return id, err
		}
		raw, err := json.Marshal(access)
		if err != nil {
			return "", err
		}
		return id, pairing.Journal.SaveAccountAccess(bindCtx, id, raw)
	}
	if !input.Secondary || pairing.InviteCode != "" {
		if _, err := bind(ctx, pairing.InviteCode, input.InviteAccess); err != nil {
			return err
		}
	}
	bindings, err := pairing.Journal.Bindings(ctx, p.base)
	if err != nil {
		return err
	}

	type event struct {
		id       string
		status   string
		finished bool
		err      error
	}
	events := make(chan event)
	send := func(update event) {
		select {
		case events <- update:
		case <-ctx.Done():
		}
	}
	statuses := make(map[string]string)
	ids := make([]string, 0, len(bindings))
	publish := func() {
		if input.BoundDevices != nil {
			input.BoundDevices(append([]string{}, ids...))
		}
		if input.Bound != nil {
			primary := ""
			if len(ids) > 0 {
				primary = ids[0]
			}
			input.Bound(primary)
		}
	}
	start := func(id string) {
		if _, exists := statuses[id]; exists {
			return
		}
		statuses[id] = "connecting"
		workerCtx, disconnect := context.WithCancel(ctx)
		ids = append(ids, id)
		workers.Add(1)
		go func() {
			defer workers.Done()
			defer disconnect()
			err := func() error {
				lifetime, err := NewExecutionLifetime(workerCtx, 5*time.Second)
				if err != nil {
					return err
				}
				defer lifetime.Close()
				factory, err := NewLocalSessionFactory(LocalOptions{AccountMode: input.AccountMode, DeviceID: id, Journal: pairing.Journal, Shell: shell, Confirm: input.Confirm, Lifetime: lifetime})
				if err != nil {
					return err
				}
				var announced *LocalSession
				var profile *MemberProfile
				return p.Run(workerCtx, RunOptions{
					DeviceID: id, Key: pairing.Key, GatewayURL: input.GatewayURL, HTTPClient: input.HTTPClient,
					Profile: func(value *MemberProfile) { profile = value },
					Status:  func(status string) { send(event{id: id, status: status}) },
					OpenSession: func(sessionCtx context.Context, owner grant.Owner) (*LocalSession, error) {
						local, err := factory(sessionCtx, owner)
						if err == nil && profile != nil {
							_ = local.Grants.UpdateMemberProfile(sessionCtx, profile.MemberName, profile.Avatar)
						}
						if err == nil && announced != local {
							announced = local
							local.Origin = p.base
							local.Disconnect = disconnect
							if input.Ready != nil {
								input.Ready(local)
							}
						}
						return local, err
					},
				})
			}()
			send(event{id: id, finished: true, err: err})
		}()
	}
	for _, binding := range bindings {
		raw, err := pairing.Journal.AccountAccess(ctx, binding.DeviceID)
		if err != nil {
			return err
		}
		var access grant.AccountAccess
		if len(raw) > 0 && json.Unmarshal(raw, &access) != nil {
			return errors.New("invalid_account_access")
		}
		if !access.Removed {
			start(binding.DeviceID)
		}
	}
	publish()
	lastStatus := ""
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case invite, ok := <-input.Invites:
			if !ok {
				input.Invites = nil
				continue
			}
			inviteCtx, stop := context.WithTimeout(ctx, 30*time.Second)
			id, err := bind(inviteCtx, invite.Code, invite.Access)
			stop()
			if err == nil {
				start(id)
				publish()
			}
			select {
			case invite.Result <- err:
			case <-ctx.Done():
			}
		case update := <-events:
			if update.finished {
				if errors.Is(update.err, ErrReauthenticationRequired) {
					if err := pairing.Journal.ForgetDevice(ctx, p.base, update.id); err != nil {
						return err
					}
				} else if !errors.Is(update.err, context.Canceled) {
					return update.err
				}
				if input.Removed != nil {
					input.Removed(update.id)
				}
				delete(statuses, update.id)
				for i, id := range ids {
					if id == update.id {
						ids = append(ids[:i], ids[i+1:]...)
						break
					}
				}
				publish()
				if len(ids) == 0 && !input.Secondary && errors.Is(update.err, ErrReauthenticationRequired) {
					return ErrReauthenticationRequired
				}
			} else {
				statuses[update.id] = update.status
			}
			status := "disconnected"
			for _, value := range statuses {
				if value == "connected" {
					status = value
					break
				}
				if value == "connecting" || value == "authenticating" {
					status = "connecting"
				}
			}
			if status != lastStatus && input.Status != nil {
				lastStatus = status
				input.Status(status)
			}
		}
	}
}
