package grant

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
)

// AccountAccess is a durable local decision for one device binding. An empty
// workdir preserves legacy session-only authorization.
type SessionScope struct {
	AppID        string `json:"appId"`
	ChatID       string `json:"chatId"`
	SourceTarget string `json:"sourceTarget"`
}

type AccountAccess struct {
	BlockedSessions []SessionScope `json:"blockedSessions,omitempty"`
	Owner           *Owner         `json:"owner,omitempty"`
	Avatar          string         `json:"avatar,omitempty"`
	Name            string         `json:"name"`
	Team            string         `json:"team"`
	Workdir         string         `json:"workdir"`
	Paused          bool           `json:"paused"`
	Removed         bool           `json:"removed"`
}

// SaveAccountAccess stores a decision made by the local device operator.
func (m *Manager) SetAccountAccess(ctx context.Context, access AccountAccess) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.access.Removed {
		return errors.New("account_access_removed")
	}
	if access.Workdir != "" && access.Workdir != m.access.Workdir {
		if !filepath.IsAbs(access.Workdir) {
			return errors.New("invalid_grant_workdir")
		}
		info, err := os.Stat(access.Workdir)
		if err != nil || !info.IsDir() {
			return errors.New("invalid_grant_workdir")
		}
	}
	access.BlockedSessions = m.access.BlockedSessions
	access.Avatar = m.access.Avatar
	owner := m.owner
	access.Owner = &owner
	raw, err := json.Marshal(access)
	if err != nil {
		return err
	}
	if err = m.ledger.SaveAccountAccess(ctx, m.owner.DeviceID, raw); err != nil {
		return err
	}
	m.access = access
	m.revocationGeneration++
	if access.Paused || access.Removed {
		clear(m.leases)
	}
	m.notify()
	return nil
}

// AccountAccess returns presentation metadata and the current local decision.
func (m *Manager) AccountAccess() AccountAccess {
	m.mu.Lock()
	defer m.mu.Unlock()
	access := m.access
	access.BlockedSessions = append([]SessionScope(nil), access.BlockedSessions...)
	if access.Owner != nil {
		owner := *access.Owner
		access.Owner = &owner
	}
	return access
}

// History is read-only and scoped to the authenticated owner. Expired entries
// are visible here without being restored into the execution manager.
func (m *Manager) History(ctx context.Context) ([]Grant, error) {
	records, err := m.ledger.ReadGrantHistory(ctx, m.owner.DeviceID)
	if err != nil {
		return nil, err
	}
	history := make([]Grant, 0, len(records))
	for _, raw := range records {
		var value Grant
		if err := json.Unmarshal(raw, &value); err != nil {
			return nil, err
		}
		if value.Owner == m.owner {
			history = append(history, value)
		}
	}
	return history, nil
}

// BlocksSession matches the conversation independently of a grant ID or version.
func (access AccountAccess) BlocksSession(value Grant) bool {
	for _, scope := range access.BlockedSessions {
		if scope == sessionScope(value) {
			return true
		}
	}
	return false
}

func sessionScope(value Grant) SessionScope {
	return SessionScope{AppID: value.AppID, ChatID: value.ChatID, SourceTarget: value.SourceTarget}
}

// RevokeSession persists a local denial and cancels leases for all versions of the conversation.
func (m *Manager) RevokeSession(ctx context.Context, id string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	value, ok := m.grants[id]
	if !ok || m.Expired(value) || value.Revoked || m.access.Removed {
		return errors.New("grant_not_found")
	}
	if m.access.BlocksSession(value) {
		return nil
	}
	access := m.access
	access.BlockedSessions = append(append([]SessionScope(nil), access.BlockedSessions...), sessionScope(value))
	owner := m.owner
	access.Owner = &owner
	raw, err := json.Marshal(access)
	if err != nil {
		return err
	}
	if err := m.ledger.SaveAccountAccess(ctx, owner.DeviceID, raw); err != nil {
		return err
	}
	m.access = access
	m.revocationGeneration++
	for id, current := range m.grants {
		if sessionScope(current) == sessionScope(value) {
			delete(m.leases, id)
		}
	}
	m.notify()
	return nil
}

// UpdateMemberProfile refreshes display metadata from the authenticated platform without changing permissions.
func (m *Manager) UpdateMemberProfile(ctx context.Context, name, avatar string) error {
	if name == "" || len(name) > 800 || len(avatar) > 2048 {
		return nil
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.access.Name == name && m.access.Avatar == avatar {
		return nil
	}
	access := m.access
	owner := m.owner
	access.Owner, access.Name, access.Avatar = &owner, name, avatar
	raw, err := json.Marshal(access)
	if err != nil {
		return err
	}
	if err := m.ledger.SaveAccountAccess(ctx, owner.DeviceID, raw); err != nil {
		return err
	}
	m.access = access
	return nil
}
