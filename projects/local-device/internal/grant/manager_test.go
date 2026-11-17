package grant

import (
	"context"
	"encoding/json"
	"path/filepath"
	"runtime"
	"testing"
	"time"

	"fastgpt.local/local-device/internal/executor"
	"fastgpt.local/local-device/internal/journal"
	"fastgpt.local/local-device/internal/operation"
)

func TestRevocationStopsNativeTask(t *testing.T) {
	m, ledger, g, r := fixture(t)
	ctx := context.Background()
	if err := m.Approve(ctx, g); err != nil {
		t.Fatal(err)
	}
	if err := m.Renew(g, time.Now().Add(30*time.Second)); err != nil {
		t.Fatal(err)
	}
	kind, command := "bash", "sleep 30"
	if runtime.GOOS == "windows" {
		kind, command = "powershell", "Start-Sleep -Seconds 30"
	}
	shell, err := executor.ResolveShell(kind)
	if err != nil {
		t.Fatal(err)
	}
	service, err := operation.New(ledger, shell, m.Authorize)
	if err != nil {
		t.Fatal(err)
	}
	r.Command = command
	r.TimeoutMs = 30000
	r.Deadline = time.Now().Add(time.Minute).UnixMilli()
	run, request, cancel, err := m.Prepare(ctx, r)
	if err != nil {
		t.Fatal(err)
	}
	defer cancel()
	finished := make(chan journal.Record, 1)
	go func() {
		record, err := service.Run(run, request)
		if err != nil {
			t.Error(err)
		}
		finished <- record
	}()
	limit := time.Now().Add(3 * time.Second)
	for {
		record, _ := ledger.Get(ctx, r.ID)
		if record.Status == "running" {
			break
		}
		if time.Now().After(limit) {
			t.Fatal("task never started")
		}
		time.Sleep(5 * time.Millisecond)
	}
	if err = m.Revoke(ctx, g.ID); err != nil {
		t.Fatal(err)
	}
	select {
	case record := <-finished:
		if record.Status != "cancelled" {
			t.Fatalf("status=%s", record.Status)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("native task survived revocation")
	}
}

func fixture(t *testing.T) (*Manager, *journal.Journal, Grant, operation.Request) {
	t.Helper()
	ledger, err := journal.Open(filepath.Join(t.TempDir(), "state"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { ledger.Close() })
	owner := Owner{TeamID: "team", MemberID: "member", DeviceID: "device"}
	manager, err := New(context.Background(), ledger, owner)
	if err != nil {
		t.Fatal(err)
	}
	g := Grant{Owner: owner, ID: "grant", Version: 1, AppID: "app", ChatID: "chat", SourceTarget: "online", ExpiresAt: time.Now().Add(time.Hour).UnixMilli(), Workdir: t.TempDir()}
	request := operation.Request{ID: "operation", GrantID: g.ID, GrantVersion: g.Version}
	return manager, ledger, g, request
}

func TestUntilRevokedApprovalSurvivesRestartWithoutPrompt(t *testing.T) {
	m, ledger, g, r := fixture(t)
	g.ExpiresAt = 0
	ctx := context.Background()
	if err := m.Approve(ctx, g); err != nil {
		t.Fatal(err)
	}
	restored, err := New(ctx, ledger, g.Owner)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = restored.ControlHandler(nil)(ctx, "grant_request", g, 0); err != nil {
		t.Fatal(err)
	}
	if restored.Authorize(r) == nil {
		t.Fatal("approval bypassed lease")
	}
	if restored.Renew(g, time.Now().Add(2*time.Minute)) == nil {
		t.Fatal("unbounded lease accepted")
	}
	if err = restored.Renew(g, time.Now().Add(30*time.Second)); err != nil {
		t.Fatal(err)
	}
	if err = restored.Authorize(r); err != nil {
		t.Fatal(err)
	}
	if err = restored.Revoke(ctx, g.ID); err != nil {
		t.Fatal(err)
	}
	restored, err = New(ctx, ledger, g.Owner)
	if err != nil {
		t.Fatal(err)
	}
	if restored.Renew(g, time.Now().Add(30*time.Second)) == nil {
		t.Fatal("revocation lost on restart")
	}
	if _, err = restored.ControlHandler(nil)(ctx, "grant_request", g, 0); err == nil {
		t.Fatal("revoked grant reused")
	}
}

func TestApprovalLeaseAndRestart(t *testing.T) {
	m, ledger, g, r := fixture(t)
	ctx := context.Background()
	if m.Authorize(r) == nil {
		t.Fatal("unapproved command allowed")
	}
	if m.Renew(g, time.Now().Add(time.Minute)) == nil {
		t.Fatal("lease created approval")
	}
	if err := m.Approve(ctx, g); err != nil {
		t.Fatal(err)
	}
	if m.Authorize(r) == nil {
		t.Fatal("approval bypassed lease")
	}
	if err := m.Renew(g, time.Now().Add(30*time.Second)); err != nil {
		t.Fatal(err)
	}
	run, prepared, cancel, err := m.Prepare(ctx, r)
	if err != nil {
		t.Fatal(err)
	}
	defer cancel()
	if prepared.Workdir != g.Workdir {
		t.Fatal("default workdir not applied")
	}
	restored, err := New(ctx, ledger, g.Owner)
	if err != nil {
		t.Fatal(err)
	}
	if restored.Authorize(r) == nil {
		t.Fatal("lease restored across restart")
	}
	if err = restored.Renew(g, time.Now().Add(30*time.Second)); err != nil {
		t.Fatal("approval not persisted", err)
	}
	if err = m.Revoke(ctx, g.ID); err != nil {
		t.Fatal(err)
	}
	select {
	case <-run.Done():
	case <-time.After(time.Second):
		t.Fatal("revocation did not cancel task")
	}
	if m.Renew(g, time.Now().Add(30*time.Second)) == nil {
		t.Fatal("revoked grant renewed")
	}
	restored, err = New(ctx, ledger, g.Owner)
	if err != nil {
		t.Fatal(err)
	}
	if restored.Renew(g, time.Now().Add(30*time.Second)) == nil {
		t.Fatal("revocation not persisted")
	}
}

func TestLeaseExpiryAndScope(t *testing.T) {
	m, _, g, r := fixture(t)
	ctx := context.Background()
	wrong := g
	wrong.MemberID = "other"
	if m.Approve(ctx, wrong) == nil {
		t.Fatal("wrong owner approved")
	}
	if err := m.Approve(ctx, g); err != nil {
		t.Fatal(err)
	}
	changed := g
	changed.ChatID = "other-chat"
	if m.Renew(changed, time.Now().Add(time.Second)) == nil {
		t.Fatal("scope changed by renewal")
	}
	if m.Renew(g, time.Now().Add(61*time.Second)) == nil {
		t.Fatal("unbounded lease")
	}
	if err := m.Renew(g, time.Now().Add(30*time.Millisecond)); err != nil {
		t.Fatal(err)
	}
	run, _, cancel, err := m.Prepare(ctx, r)
	if err != nil {
		t.Fatal(err)
	}
	defer cancel()
	select {
	case <-run.Done():
	case <-time.After(time.Second):
		t.Fatal("expired lease did not cancel")
	}
	if m.Authorize(r) == nil {
		t.Fatal("expired lease authorized")
	}
}

func TestRenewalDoesNotCancelRunningTask(t *testing.T) {
	m, _, g, r := fixture(t)
	ctx := context.Background()
	if err := m.Approve(ctx, g); err != nil {
		t.Fatal(err)
	}
	if err := m.Renew(g, time.Now().Add(100*time.Millisecond)); err != nil {
		t.Fatal(err)
	}
	run, _, cancel, err := m.Prepare(ctx, r)
	if err != nil {
		t.Fatal(err)
	}
	defer cancel()
	if err = m.Renew(g, time.Now().Add(10*time.Second)); err != nil {
		t.Fatal(err)
	}
	select {
	case <-run.Done():
		t.Fatal("renewed lease cancelled")
	case <-time.After(150 * time.Millisecond):
	}
	cancel()
	select {
	case <-run.Done():
	case <-time.After(time.Second):
		t.Fatal("caller cancel ignored")
	}
}

func TestRevokeAllPersistsAndInvalidatesPendingConfirmation(t *testing.T) {
	m, ledger, g, r := fixture(t)
	ctx := context.Background()
	if err := m.Approve(ctx, g); err != nil {
		t.Fatal(err)
	}
	if err := m.Renew(g, time.Now().Add(30*time.Second)); err != nil {
		t.Fatal(err)
	}
	run, _, cancel, err := m.Prepare(ctx, r)
	if err != nil {
		t.Fatal(err)
	}
	defer cancel()
	entered, release := make(chan struct{}), make(chan struct{})
	control := m.ControlHandler(func(context.Context, Grant) (string, error) {
		close(entered)
		<-release
		return g.Workdir, nil
	})
	pending := g
	pending.ID = "pending-grant"
	done := make(chan error, 1)
	go func() { _, err := control(ctx, "grant_request", pending, 0); done <- err }()
	<-entered
	if err := m.RevokeAll(ctx); err != nil {
		t.Fatal(err)
	}
	close(release)
	if err := <-done; err == nil || err.Error() != "local_confirmation_expired" {
		t.Fatalf("stale dialog approved: %v", err)
	}
	select {
	case <-run.Done():
	case <-time.After(time.Second):
		t.Fatal("revocation left execution alive")
	}
	if err := m.Renew(g, time.Now().Add(time.Second)); err == nil {
		t.Fatal("revoked lease renewed")
	}
	restored, err := New(ctx, ledger, g.Owner)
	if err != nil {
		t.Fatal(err)
	}
	if err := restored.Renew(g, time.Now().Add(time.Second)); err == nil {
		t.Fatal("revocation lost on restart")
	}
	// A new explicit confirmation after revocation remains available.
	confirmed := m.ControlHandler(func(context.Context, Grant) (string, error) { return g.Workdir, nil })
	if _, err := confirmed(ctx, "grant_request", pending, 0); err != nil {
		t.Fatalf("fresh confirmation rejected: %v", err)
	}
}

func TestRevokeAllPersistenceFailureStillDeniesCommands(t *testing.T) {
	m, _, g, r := fixture(t)
	if err := m.Approve(context.Background(), g); err != nil {
		t.Fatal(err)
	}
	if err := m.Renew(g, time.Now().Add(30*time.Second)); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if err := m.RevokeAll(ctx); err == nil {
		t.Fatal("persistence failure hidden")
	}
	if err := m.Authorize(r); err == nil {
		t.Fatal("command survived failed persistence")
	}
	if err := m.RevokeAll(context.Background()); err != nil {
		t.Fatalf("persistence retry failed: %v", err)
	}
}

func TestPermissionComparisonIgnoresDisplayAllocation(t *testing.T) {
	g := Grant{ID: "grant", Version: 1, AppID: "app", ChatID: "chat", SourceTarget: "source", Workdir: "/tmp", Display: &DisplayNames{TeamName: "team"}}
	var decoded Grant
	raw, _ := json.Marshal(g)
	if err := json.Unmarshal(raw, &decoded); err != nil {
		t.Fatal(err)
	}
	if !g.SamePermission(decoded) {
		t.Fatal("JSON roundtrip changed permission")
	}
	decoded.Display = nil
	if !g.SamePermission(decoded) {
		t.Fatal("display absence changed permission")
	}
	decoded.Workdir = "/other"
	if g.SamePermission(decoded) {
		t.Fatal("directory change ignored")
	}
	decoded = g
	decoded.Version++
	if g.SamePermission(decoded) {
		t.Fatal("version change ignored")
	}
}

func TestDisplayMetadataSurvivesGrantLifecycleRoundTrips(t *testing.T) {
	m, ledger, g, _ := fixture(t)
	defer ledger.Close()
	g.Display = &DisplayNames{TeamName: "team", AppName: "assistant"}
	ctx := context.Background()
	if err := m.Approve(ctx, g); err != nil {
		t.Fatal(err)
	}
	raw, _ := json.Marshal(g)
	var request Grant
	if err := json.Unmarshal(raw, &request); err != nil {
		t.Fatal(err)
	}
	control := m.ControlHandler(nil)
	if _, err := control(ctx, "grant_request", request, 0); err != nil {
		t.Fatal("replay requested confirmation", err)
	}
	request.Display = nil
	if _, err := control(ctx, "grant_renew", request, time.Now().Add(10*time.Second).UnixMilli()); err != nil {
		t.Fatal("renewal rejected presentation change", err)
	}
	if _, err := control(ctx, "grant_revoke", request, 0); err != nil {
		t.Fatal("revoke rejected presentation change", err)
	}
}
