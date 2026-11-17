// Package grant enforces local user approval separately from short-lived online execution leases.
package grant

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"sync"
	"time"

	"fastgpt.local/local-device/internal/journal"
	"fastgpt.local/local-device/internal/operation"
	"fastgpt.local/local-device/internal/remoteclock"
)

type Owner struct {
	TeamID   string `json:"teamId"`
	MemberID string `json:"memberId"`
	DeviceID string `json:"deviceId"`
}
type Grant struct {
	Owner
	ID           string        `json:"grantId"`
	Version      int64         `json:"version"`
	AppID        string        `json:"appId"`
	ChatID       string        `json:"chatId"`
	SourceTarget string        `json:"sourceTarget"`
	ExpiresAt    int64         `json:"expiresAt"`
	Workdir      string        `json:"workdir"`
	Revoked      bool          `json:"revoked"`
	Display      *DisplayNames `json:"display,omitempty"`
}

// DisplayNames is presentation-only metadata from the authenticated platform; IDs still define permission scope.
type DisplayNames struct {
	InitialWorkdir string `json:"initialWorkdir,omitempty"`
	TeamName       string `json:"teamName"`
	MemberName     string `json:"memberName"`
	AppName        string `json:"appName"`
	ChatTitle      string `json:"chatTitle"`
}
type Manager struct {
	clock                *remoteclock.Clock
	access               AccountAccess
	mu                   sync.Mutex
	ledger               *journal.Journal
	owner                Owner
	grants               map[string]Grant
	leases               map[string]time.Time
	changed              chan struct{}
	revocationGeneration uint64
}

var identifier = regexp.MustCompile(`^[A-Za-z0-9_-]{1,128}$`)

// New restores approvals but never restores leases. An online authority must renew them.
func New(ctx context.Context, ledger *journal.Journal, owner Owner, clocks ...*remoteclock.Clock) (*Manager, error) {
	if ledger == nil || owner.TeamID == "" || owner.MemberID == "" || owner.DeviceID == "" {
		return nil, errors.New("invalid_grant_owner")
	}
	records, err := ledger.ReadGrants(ctx)
	if err != nil {
		return nil, err
	}
	m := &Manager{ledger: ledger, owner: owner, grants: map[string]Grant{}, leases: map[string]time.Time{}, changed: make(chan struct{})}
	m.clock = remoteclock.New()
	if len(clocks) > 0 && clocks[0] != nil {
		m.clock = clocks[0]
	}
	rawAccess, err := ledger.AccountAccess(ctx, owner.DeviceID)
	if err != nil {
		return nil, err
	}
	if len(rawAccess) > 0 && json.Unmarshal(rawAccess, &m.access) != nil {
		return nil, errors.New("invalid_account_access")
	}
	if m.access.Owner != nil && *m.access.Owner != owner {
		return nil, errors.New("account_access_owner_mismatch")
	}
	if len(rawAccess) > 0 && m.access.Owner == nil {
		// The first authenticated welcome locks an accepted invite to its platform owner.
		m.access.Owner = &owner
		encoded, err := json.Marshal(m.access)
		if err != nil {
			return nil, err
		}
		if err := ledger.SaveAccountAccess(ctx, owner.DeviceID, encoded); err != nil {
			return nil, err
		}
	}
	for _, raw := range records {
		var g Grant
		if json.Unmarshal(raw, &g) != nil || !identifier.MatchString(g.ID) || g.Version < 1 {
			return nil, errors.New("invalid_stored_grant")
		}
		if g.Owner == owner {
			m.grants[g.ID] = g
		}
	}
	return m, nil
}

// Approve is a local UI action, not a handler for automatic cloud messages. Workdir is
// selected locally and is a default directory, not a filesystem security boundary.
func (m *Manager) Approve(ctx context.Context, g Grant) error {
	return m.approve(ctx, g, nil)
}

// approve atomically checks the local confirmation generation with publication.
// A dialog opened before a revoke-all action cannot restore permission afterwards.
func (m *Manager) approve(ctx context.Context, g Grant, generation *uint64) error {
	if g.Owner != m.owner || !identifier.MatchString(g.ID) || g.Version < 1 || g.AppID == "" || g.ChatID == "" || g.SourceTarget == "" || g.Revoked || m.Expired(g) || !filepath.IsAbs(g.Workdir) {
		return errors.New("invalid_local_grant")
	}
	info, err := os.Stat(g.Workdir)
	if err != nil || !info.IsDir() {
		return errors.New("invalid_grant_workdir")
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.access.Paused || m.access.Removed {
		return errors.New("account_access_paused")
	}
	if m.access.BlocksSession(g) {
		return errors.New("grant_revoked")
	}
	if generation != nil && *generation != m.revocationGeneration {
		return errors.New("local_confirmation_expired")
	}
	for id, existing := range m.grants {
		if m.Expired(existing) {
			delete(m.grants, id)
			delete(m.leases, id)
		}
	}
	if old, ok := m.grants[g.ID]; ok {
		if old.SamePermission(g) {
			return nil
		}
		if g.Version <= old.Version || g.Owner != old.Owner || g.AppID != old.AppID || g.ChatID != old.ChatID || g.SourceTarget != old.SourceTarget {
			return errors.New("grant_version_conflict")
		}
	} else if len(m.grants) >= 100 {
		return errors.New("local_grant_limit")
	}
	raw, err := json.Marshal(g)
	if err != nil {
		return err
	}
	if err = m.ledger.SaveGrant(ctx, g.ID, raw); err != nil {
		return err
	}
	m.grants[g.ID] = g
	delete(m.leases, g.ID)
	m.notify()
	return nil
}

// Renew may be called only from the authenticated platform lease channel. It cannot
// create approval, revive a revoked grant, change scope or extend approval expiration.
func (m *Manager) Renew(g Grant, expires time.Time) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	approved, ok := m.grants[g.ID]
	// 保持原有拒绝条件，分别返回原因，避免续租失败被误判为命令内容受限。
	if m.access.Removed {
		return errors.New("account_access_removed")
	}
	if m.access.Paused {
		return errors.New("account_access_paused")
	}
	if m.access.BlocksSession(g) || (ok && approved.Revoked) {
		return errors.New("grant_revoked")
	}
	if !ok {
		return errors.New("grant_unavailable")
	}
	if !approved.SamePermission(g) {
		return errors.New("grant_scope_mismatch")
	}
	if m.Expired(approved) {
		return errors.New("grant_expired")
	}
	now := m.clock.Now()
	remaining := expires.Sub(now)
	if remaining <= 0 || remaining > 60*time.Second || (approved.ExpiresAt != 0 && expires.UnixMilli() > approved.ExpiresAt) {
		return errors.New("invalid_execution_lease")
	}
	// Store a local monotonic deadline, never a server wall-clock timestamp.
	m.leases[g.ID] = time.Now().Add(remaining)
	m.notify()
	return nil
}

// Snapshot returns detached, active approvals for local presentation; it never exposes execution leases.
func (m *Manager) Snapshot() []Grant {
	m.mu.Lock()
	defer m.mu.Unlock()
	result := make([]Grant, 0, len(m.grants))
	for _, value := range m.grants {
		if !value.Revoked && !m.Expired(value) {
			if value.Display != nil {
				display := *value.Display
				value.Display = &display
			}
			result = append(result, value)
		}
	}
	sort.Slice(result, func(i, j int) bool { return result[i].ID < result[j].ID })
	return result
}

// Revoke immediately stops local execution, even when persisting the decision fails.
// A persistence error is returned so the UI cannot claim a durable revocation succeeded.
func (m *Manager) Revoke(ctx context.Context, id string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	g, ok := m.grants[id]
	if !ok {
		return errors.New("grant_not_found")
	}
	g.Revoked = true
	m.grants[id] = g
	delete(m.leases, id)
	m.notify()
	raw, err := json.Marshal(g)
	if err != nil {
		return err
	}
	if err = m.ledger.SaveGrant(ctx, id, raw); err != nil {
		return err
	}
	return nil
}

// RevokeAll invalidates pending confirmations and all current execution leases
// before attempting disk persistence. Failure is surfaced; callers must keep the
// executor paused rather than claiming revocation will survive a restart.
func (m *Manager) RevokeAll(ctx context.Context) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.revocationGeneration++
	ids := make([]string, 0, len(m.grants))
	for id, value := range m.grants {
		value.Revoked = true
		m.grants[id] = value
		delete(m.leases, id)
		ids = append(ids, id)
	}
	m.notify()
	return m.ledger.RevokeGrants(ctx, ids)
}

func (m *Manager) notify() { close(m.changed); m.changed = make(chan struct{}) }
func (m *Manager) check(r operation.Request) (Grant, time.Time, error) {
	g, ok := m.grants[r.GrantID]
	lease := m.leases[r.GrantID]
	if m.access.Paused || m.access.Removed || !ok || m.access.BlocksSession(g) || g.Revoked || g.Version != r.GrantVersion || m.Expired(g) || !lease.After(time.Now()) {
		return Grant{}, time.Time{}, errors.New("grant_revoked")
	}
	return g, lease, nil
}

// Authorize is suitable for the executor's pre-dispatch and pre-launch rechecks.
func (m *Manager) Authorize(r operation.Request) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	_, _, err := m.check(r)
	return err
}

// Prepare fixes the default directory and cancels a live task on local revocation or
// lease expiry. Renewal wakes the monitor; a stale timer cannot cancel a renewed lease.
func (m *Manager) Prepare(parent context.Context, r operation.Request) (context.Context, operation.Request, context.CancelFunc, error) {
	m.mu.Lock()
	g, _, err := m.check(r)
	m.mu.Unlock()
	if err != nil {
		return nil, r, nil, err
	}
	if r.Workdir == "" {
		r.Workdir = g.Workdir
	}
	ctx, cancel := context.WithCancelCause(parent)
	go func() {
		defer cancel(nil)
		for {
			m.mu.Lock()
			_, lease, err := m.check(r)
			// API 对外仍统一拒绝；本地诊断区分撤销、授权到期与短租约到期。
			if err != nil && !m.access.Paused && !m.access.Removed {
				g, ok := m.grants[r.GrantID]
				if ok && !m.access.BlocksSession(g) && !g.Revoked && g.Version == r.GrantVersion {
					if m.Expired(g) {
						err = errors.New("grant_expired")
					} else {
						err = errors.New("execution_lease_expired")
					}
				}
			}
			changed := m.changed
			m.mu.Unlock()
			if err != nil {
				cancel(err)
				return
			}
			timer := time.NewTimer(time.Until(lease))
			select {
			case <-ctx.Done():
				timer.Stop()
				return
			case <-changed:
				timer.Stop()
			case <-timer.C:
			}
		}
	}()
	return ctx, r, func() { cancel(nil) }, nil
}

// SamePermission compares every permission field by value. Display names are untrusted
// presentation metadata and must not break replay, renewal or revocation after JSON decoding.
func (g Grant) SamePermission(other Grant) bool {
	g.Display, other.Display = nil, nil
	return g == other
}

// Expired checks platform-owned approval against platform time, including local
// management views. Zero remains an explicit until-revoked approval, never a lease.
func (m *Manager) Expired(g Grant) bool {
	return g.ExpiresAt < 0 || (g.ExpiresAt != 0 && g.ExpiresAt <= m.clock.Now().UnixMilli())
}
