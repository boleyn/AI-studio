package grant

import (
	"context"
	"encoding/json"
	"errors"
	"time"
)

// ControlHandler requires an explicit local confirmation callback for new approval.
// The callback returns a locally chosen directory; a cloud-provided directory is ignored.
func (m *Manager) ControlHandler(confirm func(context.Context, Grant) (string, error)) func(context.Context, string, Grant, int64) (Grant, error) {
	prompts := make(chan struct{}, 1)
	return func(ctx context.Context, kind string, value Grant, leaseExpiresAt int64) (Grant, error) {
		if value.Owner != m.owner {
			return Grant{}, errors.New("grant_owner_mismatch")
		}
		switch kind {
		case "grant_request":
			// Existing identical approval can survive reconnect without another user prompt.
			m.mu.Lock()
			existing, ok := m.grants[value.ID]
			generation := m.revocationGeneration
			if m.access.Name == "" && value.Display != nil && value.Display.MemberName != "" {
				// Authenticated names help identify legacy users; no permissions are added here.
				display := m.access
				owner := m.owner
				display.Owner = &owner
				display.Name, display.Team = value.Display.MemberName, value.Display.TeamName
				if raw, err := json.Marshal(display); err == nil && m.ledger.SaveAccountAccess(ctx, m.owner.DeviceID, raw) == nil {
					m.access = display
				}
			}
			access := m.access
			m.mu.Unlock()
			if access.BlocksSession(value) {
				return Grant{}, errors.New("grant_revoked")
			}
			if access.Paused || access.Removed {
				return Grant{}, errors.New("account_access_paused")
			}
			expected := value
			expected.Workdir = existing.Workdir
			if ok && existing.SamePermission(expected) && !existing.Revoked && !m.Expired(existing) {
				return existing, nil
			}
			// 替换授权由平台携带旧目录，必须让本机用户重新选择。
			changingDirectory := value.Display != nil && value.Display.InitialWorkdir != ""
			if access.Workdir != "" && !changingDirectory {
				value.Workdir = access.Workdir
				if err := m.approve(ctx, value, &generation); err != nil {
					return Grant{}, err
				}
				return value, nil
			}
			if confirm == nil {
				return Grant{}, errors.New("local_confirmation_required")
			}
			select {
			case prompts <- struct{}{}:
				defer func() { <-prompts }()
			default:
				return Grant{}, errors.New("local_confirmation_busy")
			}
			value.Workdir = ""
			directory, err := confirm(ctx, value)
			if err != nil {
				return Grant{}, err
			}
			if err = ctx.Err(); err != nil {
				return Grant{}, err
			}
			value.Workdir = directory
			if err = m.approve(ctx, value, &generation); err != nil {
				return Grant{}, err
			}
			return value, nil
		case "grant_renew":
			if err := m.Renew(value, time.UnixMilli(leaseExpiresAt)); err != nil {
				return Grant{}, err
			}
			return value, nil
		case "grant_revoke":
			m.mu.Lock()
			existing, ok := m.grants[value.ID]
			m.mu.Unlock()
			if !ok || !existing.SamePermission(value) {
				return Grant{}, errors.New("grant_scope_mismatch")
			}
			if err := m.Revoke(ctx, value.ID); err != nil {
				return Grant{}, err
			}
			value.Revoked = true
			return value, nil
		default:
			return Grant{}, errors.New("unsupported_grant_control")
		}
	}
}
