package desktop

import (
	"context"
	"errors"
	"fastgpt.local/local-device/internal/grant"
	"strings"
	"testing"

	"fastgpt.local/local-device/internal/connector"
)

func TestRevokedIdentityWaitsForNewPairing(t *testing.T) {
	calls := 0
	cleared := false
	done := errors.New("stop")
	err := runUntilCancelled(context.Background(), connector.StartOptions{Bound: func(id string) { cleared = id == "" }}, func(ctx context.Context, input connector.StartOptions) error {
		calls++
		if calls == 1 {
			if input.RePair {
				t.Fatal("discarded identity before rejection")
			}
			return connector.ErrReauthenticationRequired
		}
		if input.RePair || !cleared {
			t.Fatal("did not clear rejected identity without resetting other bindings")
		}
		return done
	})
	if !errors.Is(err, done) || calls != 2 {
		t.Fatalf("calls=%d err=%v", calls, err)
	}
}

func TestOtherFailuresDoNotDiscardIdentity(t *testing.T) {
	for _, failure := range []error{context.Canceled, errors.New("network unavailable")} {
		calls := 0
		err := runUntilCancelled(context.Background(), connector.StartOptions{Bound: func(string) { t.Fatal("discarded identity") }}, func(context.Context, connector.StartOptions) error { calls++; return failure })
		if !errors.Is(err, failure) || calls != 1 {
			t.Fatal("unexpected retry", err)
		}
	}
}

func TestCancelledReauthenticationDoesNotRestart(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	calls := 0
	err := runUntilCancelled(ctx, connector.StartOptions{}, func(context.Context, connector.StartOptions) error {
		calls++
		cancel()
		return connector.ErrReauthenticationRequired
	})
	if !errors.Is(err, context.Canceled) || calls != 1 {
		t.Fatal("restarted after cancellation", err)
	}
}

func TestApprovalUsesNamesInsteadOfIDs(t *testing.T) {
	value := grant.Grant{Owner: grant.Owner{TeamID: "private-team-id", MemberID: "private-member-id"}, AppID: "private-app-id", ChatID: "private-chat-id", Display: &grant.DisplayNames{TeamName: "研发团队", MemberName: "张三", AppName: "工作助手", ChatTitle: "整理文件"}}
	message := executionApprovalMessage(value, "直到撤销")
	for _, name := range []string{"研发团队", "张三", "工作助手", "整理文件"} {
		if !strings.Contains(message, name) {
			t.Fatal("missing display name", name)
		}
	}
	if strings.Contains(message, "private-") {
		t.Fatal("internal IDs exposed")
	}
	value.Display = nil
	if strings.Contains(executionApprovalMessage(value, "直到撤销"), "private-") {
		t.Fatal("fallback exposed internal IDs")
	}
}
