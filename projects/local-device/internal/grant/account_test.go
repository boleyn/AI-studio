package grant

import (
	"context"
	"path/filepath"
	"testing"
	"time"

	"fastgpt.local/local-device/internal/journal"
	"fastgpt.local/local-device/internal/operation"
)

func TestAccountAccessPausesOnlySelectedUserAndSurvivesRestore(t *testing.T) {
	ctx := context.Background()
	ledger, err := journal.Open(filepath.Join(t.TempDir(), "state"))
	if err != nil {
		t.Fatal(err)
	}
	defer ledger.Close()
	newManager := func(owner Owner) *Manager {
		t.Helper()
		manager, err := New(ctx, ledger, owner)
		if err != nil {
			t.Fatal(err)
		}
		return manager
	}
	alice := Owner{DeviceID: "alice-device", MemberID: "alice", TeamID: "team"}
	bob := Owner{DeviceID: "bob-device", MemberID: "bob", TeamID: "team"}
	first, second := newManager(alice), newManager(bob)
	workdir := t.TempDir()
	value := Grant{Owner: alice, ID: "first-grant", Version: 1, AppID: "app", ChatID: "chat", SourceTarget: "source"}
	if _, err := first.ControlHandler(nil)(ctx, "grant_request", value, 0); err == nil {
		t.Fatal("legacy binding obtained new execution permission")
	}
	for _, manager := range []*Manager{first, second} {
		if err := manager.SetAccountAccess(ctx, AccountAccess{Workdir: workdir}); err != nil {
			t.Fatal(err)
		}
	}
	approve := func(manager *Manager, value Grant) operation.Request {
		t.Helper()
		approved, err := manager.ControlHandler(nil)(ctx, "grant_request", value, 0)
		if err != nil || approved.Workdir != workdir {
			t.Fatalf("grant = %+v, err = %v", approved, err)
		}
		if err := manager.Renew(approved, time.Now().Add(30*time.Second)); err != nil {
			t.Fatal(err)
		}
		return operation.Request{GrantID: value.ID, GrantVersion: value.Version}
	}
	firstRequest := approve(first, value)
	crossProject := value
	crossProject.ID, crossProject.AppID, crossProject.ChatID, crossProject.SourceTarget = "another-grant", "another-project", "another-chat", "project:another-project"
	approve(newManager(alice), crossProject)
	value.Owner, value.ID = bob, "second-grant"
	secondRequest := approve(second, value)
	running, _, stop, err := first.Prepare(ctx, firstRequest)
	if err != nil {
		t.Fatal(err)
	}
	defer stop()
	access := first.AccountAccess()
	access.Paused = true
	if err := first.SetAccountAccess(ctx, access); err != nil {
		t.Fatal(err)
	}
	select {
	case <-running.Done():
	case <-time.After(time.Second):
		t.Fatal("running task was not cancelled")
	}
	if first.Authorize(firstRequest) == nil || second.Authorize(secondRequest) != nil {
		t.Fatal("pause did not isolate users")
	}
	wrongOwner := alice
	wrongOwner.MemberID = bob.MemberID
	if _, err := New(ctx, ledger, wrongOwner); err == nil {
		t.Fatal("another member inherited durable account access")
	}
	restored := newManager(alice)
	if !restored.AccountAccess().Paused {
		t.Fatal("pause was lost")
	}
	access.Paused = false
	if err := restored.SetAccountAccess(ctx, access); err != nil {
		t.Fatal(err)
	}
	if restored.Authorize(firstRequest) == nil {
		t.Fatal("resume restored an old lease")
	}
}

func TestRevokedConversationRejectsNewGrantAfterRestart(t *testing.T) {
	ctx := context.Background()
	ledger, err := journal.Open(filepath.Join(t.TempDir(), "state"))
	if err != nil {
		t.Fatal(err)
	}
	defer ledger.Close()
	owner := Owner{DeviceID: "device", MemberID: "member", TeamID: "team"}
	manager, err := New(ctx, ledger, owner)
	if err != nil {
		t.Fatal(err)
	}
	if err := manager.SetAccountAccess(ctx, AccountAccess{Workdir: t.TempDir()}); err != nil {
		t.Fatal(err)
	}
	original := Grant{Owner: owner, ID: "original", Version: 1, AppID: "app", ChatID: "chat", SourceTarget: "source"}
	approved, err := manager.ControlHandler(nil)(ctx, "grant_request", original, 0)
	if err != nil {
		t.Fatal(err)
	}
	if err := manager.Renew(approved, time.Now().Add(30*time.Second)); err != nil {
		t.Fatal(err)
	}
	request := operation.Request{GrantID: original.ID, GrantVersion: original.Version}
	running, _, stop, err := manager.Prepare(ctx, request)
	if err != nil {
		t.Fatal(err)
	}
	defer stop()
	if err := manager.RevokeSession(ctx, original.ID); err != nil {
		t.Fatal(err)
	}
	select {
	case <-running.Done():
	case <-time.After(time.Second):
		t.Fatal("revoked conversation kept running")
	}
	manager, err = New(ctx, ledger, owner)
	if err != nil {
		t.Fatal(err)
	}
	if err := manager.SetAccountAccess(ctx, manager.AccountAccess()); err != nil {
		t.Fatal(err)
	}
	original.ID = "replacement"
	if _, err := manager.ControlHandler(nil)(ctx, "grant_request", original, 0); err == nil || err.Error() != "grant_revoked" {
		t.Fatalf("revoked conversation accepted new grant: %v", err)
	}
	original.ChatID = "different-chat"
	if _, err := manager.ControlHandler(nil)(ctx, "grant_request", original, 0); err != nil {
		t.Fatalf("unrelated conversation blocked: %v", err)
	}
}

func TestChangeDirectoryPromptsWithAccountAccess(t *testing.T) {
	ctx := context.Background()
	ledger, err := journal.Open(filepath.Join(t.TempDir(), "state"))
	if err != nil {
		t.Fatal(err)
	}
	defer ledger.Close()
	owner := Owner{DeviceID: "device", MemberID: "member", TeamID: "team"}
	manager, err := New(ctx, ledger, owner)
	if err != nil {
		t.Fatal(err)
	}
	initial, chosen := t.TempDir(), t.TempDir()
	if err := manager.SetAccountAccess(ctx, AccountAccess{Workdir: initial}); err != nil {
		t.Fatal(err)
	}
	prompts := 0
	control := manager.ControlHandler(func(_ context.Context, value Grant) (string, error) {
		prompts++
		if value.Display == nil || value.Display.InitialWorkdir != initial {
			t.Fatal("prompt did not receive the current directory")
		}
		return chosen, nil
	})
	value := Grant{Owner: owner, ID: "initial", Version: 1, AppID: "app", ChatID: "chat", SourceTarget: "source"}
	if result, err := control(ctx, "grant_request", value, 0); err != nil || result.Workdir != initial || prompts != 0 {
		t.Fatalf("ordinary grant should use account directory without prompting: %v", err)
	}
	value.ID = "replacement"
	value.Display = &DisplayNames{InitialWorkdir: initial}
	for i := 0; i < 2; i++ {
		if result, err := control(ctx, "grant_request", value, 0); err != nil || result.Workdir != chosen {
			t.Fatalf("replacement did not retain the locally selected directory: %v", err)
		}
	}
	if prompts != 1 || manager.AccountAccess().Workdir != initial {
		t.Fatal("replacement should prompt once and preserve the account default")
	}
}
