package grant

import (
	"context"
	"testing"
	"time"

	"fastgpt.local/local-device/internal/remoteclock"
)

func TestPlatformClockPreservesApprovalAndLeaseBounds(t *testing.T) {
	for _, offset := range []time.Duration{-24 * time.Hour, 24 * time.Hour} {
		t.Run(offset.String(), func(t *testing.T) {
			m, _, g, r := fixture(t)
			clock := remoteclock.New()
			remote := time.Now().Add(offset)
			clock.Observe(remote.UnixMilli())
			m.clock = clock
			g.ExpiresAt = remote.Add(30 * time.Second).UnixMilli()
			if err := m.Approve(context.Background(), g); err != nil {
				t.Fatal(err)
			}
			for _, expiry := range []time.Time{remote.Add(-time.Second), remote.Add(31 * time.Second), remote.Add(61 * time.Second)} {
				if err := m.Renew(g, expiry); err == nil || err.Error() != "invalid_execution_lease" {
					t.Fatalf("invalid lease accepted: %v", err)
				}
			}
			if err := m.Renew(g, remote.Add(20*time.Second)); err != nil {
				t.Fatal(err)
			}
			if err := m.Authorize(r); err != nil {
				t.Fatal(err)
			}
			clock.Observe(remote.Add(31 * time.Second).UnixMilli())
			if m.Authorize(r) == nil {
				t.Fatal("expired approval retained execution")
			}
			if err := m.Renew(g, remote.Add(40*time.Second)); err == nil || err.Error() != "grant_expired" {
				t.Fatalf("expired approval renewed: %v", err)
			}
		})
	}
}
