package grant

import (
	"context"
	"testing"
	"time"
)

func TestRenewFailureCategoriesPreserveRejection(t *testing.T) {
	for _, code := range []string{"account_access_removed", "account_access_paused", "grant_revoked", "grant_unavailable", "grant_scope_mismatch", "grant_expired", "invalid_execution_lease"} {
		t.Run(code, func(t *testing.T) {
			m, _, g, r := fixture(t)
			if err := m.Approve(context.Background(), g); err != nil {
				t.Fatal(err)
			}
			expires := time.Now().Add(30 * time.Second)
			switch code {
			case "account_access_removed":
				m.access.Removed = true
			case "account_access_paused":
				m.access.Paused = true
			case "grant_revoked":
				m.access.BlockedSessions = []SessionScope{sessionScope(g)}
			case "grant_unavailable":
				delete(m.grants, g.ID)
			case "grant_scope_mismatch":
				g.Workdir += "-changed"
			case "grant_expired":
				g.ExpiresAt = time.Now().Add(-time.Second).UnixMilli()
				m.grants[g.ID] = g
			case "invalid_execution_lease":
				expires = time.Now().Add(61 * time.Second)
			}
			if err := m.Renew(g, expires); err == nil || err.Error() != code {
				t.Fatalf("expected %s, got %v", code, err)
			}
			if m.Authorize(r) == nil {
				t.Fatal("failed renewal permitted execution")
			}
		})
	}
}
