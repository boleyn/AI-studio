package connector

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"runtime"
	"testing"
	"time"

	"fastgpt.local/local-device/internal/executor"
	"fastgpt.local/local-device/internal/grant"
	"fastgpt.local/local-device/internal/journal"
	"fastgpt.local/local-device/internal/operation"
)

func TestLocalSessionCompositionAndReconnect(t *testing.T) {
	ctx := context.Background()
	dir := t.TempDir()
	ledger, err := journal.Open(filepath.Join(dir, "state"))
	if err != nil {
		t.Fatal(err)
	}
	defer ledger.Close()
	kind := "bash"
	if runtime.GOOS == "windows" {
		kind = "powershell"
	}
	shell, err := executor.ResolveShell(kind)
	if err != nil {
		t.Fatal(err)
	}
	confirmations := 0
	open, err := NewLocalSessionFactory(LocalOptions{DeviceID: "device", Journal: ledger, Shell: shell, Confirm: func(_ context.Context, value grant.Grant) (string, error) {
		confirmations++
		if value.Workdir != "" {
			t.Error("cloud selected local directory")
		}
		return dir, nil
	}})
	if err != nil {
		t.Fatal(err)
	}
	owner := grant.Owner{DeviceID: "device", TeamID: "team", MemberID: "member"}
	local, err := open(ctx, owner)
	if err != nil {
		t.Fatal(err)
	}
	g := grant.Grant{Owner: owner, ID: "grant", Version: 1, AppID: "app", ChatID: "chat", SourceTarget: "source", ExpiresAt: time.Now().Add(time.Hour).UnixMilli(), Workdir: "/remote-suggested"}
	// 授权尚不存在时，续租必须保留真实原因并持久化安全诊断，不触发确认或执行。
	if _, err := local.Control(ctx, "grant_renew", g, time.Now().Add(30*time.Second).UnixMilli()); err == nil || err.Error() != "grant_unavailable" {
		t.Fatalf("missing grant error: %v", err)
	}
	raw, err := os.ReadFile(filepath.Join(dir, "state", "grant-diagnostics.jsonl"))
	if err != nil {
		t.Fatal(err)
	}
	var diagnostic journal.GrantDiagnostic
	if err := json.Unmarshal(raw, &diagnostic); err != nil || diagnostic.Stage != "grant_renew" || diagnostic.Code != "grant_unavailable" || diagnostic.GrantID != g.ID || diagnostic.LeaseRemainingMs <= 0 {
		t.Fatalf("invalid grant diagnostic: %s", raw)
	}
	if confirmations != 0 {
		t.Fatal("renewal opened approval window")
	}
	r := operation.Request{ID: "operation", GrantID: g.ID, GrantVersion: 1, Command: "echo ready", Workdir: dir, TimeoutMs: 1000, Deadline: time.Now().Add(time.Minute).UnixMilli()}
	// 本用例验证组合与重连，不测试命令超时；Windows PowerShell 冷启动可能超过 1 秒。
	if runtime.GOOS == "windows" {
		r.TimeoutMs = 10000
	}
	if _, err := local.Service.Run(ctx, r); err == nil {
		t.Fatal("unapproved task started")
	}
	g, err = local.Control(ctx, "grant_request", g, 0)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := local.Control(ctx, "grant_renew", g, time.Now().Add(30*time.Second).UnixMilli()); err != nil {
		t.Fatal(err)
	}
	local.Service.SetPaused(true)
	reconnected, err := open(ctx, owner)
	if err != nil || reconnected != local {
		t.Fatalf("reconnect replaced executor: %v", err)
	}
	if _, err := reconnected.Service.Run(ctx, r); err == nil || err.Error() != "device_paused" {
		t.Fatalf("pause lost: %v", err)
	}
	if _, err := reconnected.Control(ctx, "grant_request", g, 0); err != nil {
		t.Fatal(err)
	}
	if confirmations != 1 {
		t.Fatalf("reconnect asked again: %d", confirmations)
	}
	for _, other := range []grant.Owner{
		{DeviceID: "other", TeamID: "team", MemberID: "member"},
		{DeviceID: "device", TeamID: "other", MemberID: "member"},
		{DeviceID: "device", TeamID: "team", MemberID: "other"},
	} {
		if _, err := open(ctx, other); err == nil {
			t.Fatal("changed owner accepted")
		}
	}
	reconnected.Service.SetPaused(false)
	if record, err := reconnected.Service.Run(ctx, r); err != nil || record.Status != "completed" {
		t.Fatalf("execution failed: %+v %v", record, err)
	}
}

func TestLocalSessionRequiresLocalConfirmation(t *testing.T) {
	if _, err := NewLocalSessionFactory(LocalOptions{}); err == nil {
		t.Fatal("missing dependencies accepted")
	}
}

func TestLocalGrantDiagnosticFailureDoesNotChangeAuthorization(t *testing.T) {
	dir := t.TempDir()
	ledger, err := journal.Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer ledger.Close()
	if err := os.Mkdir(filepath.Join(dir, "grant-diagnostics.jsonl"), 0700); err != nil {
		t.Fatal(err)
	}
	open, err := NewLocalSessionFactory(LocalOptions{AccountMode: true, DeviceID: "device", Journal: ledger})
	if err != nil {
		t.Fatal(err)
	}
	owner := grant.Owner{DeviceID: "device", TeamID: "team", MemberID: "member"}
	local, err := open(context.Background(), owner)
	if err != nil {
		t.Fatal(err)
	}
	_, err = local.Control(context.Background(), "grant_renew", grant.Grant{Owner: owner, ID: "grant", Version: 1}, time.Now().Add(30*time.Second).UnixMilli())
	if err == nil || err.Error() != "grant_unavailable" {
		t.Fatalf("diagnostic failure changed original result: %v", err)
	}
}
