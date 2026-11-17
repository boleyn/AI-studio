package desktop

import (
	"bytes"
	"context"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"

	"fastgpt.local/local-device/internal/connector"
	"fastgpt.local/local-device/internal/executor"
	"fastgpt.local/local-device/internal/grant"
	"fastgpt.local/local-device/internal/journal"
	"fastgpt.local/local-device/internal/operation"
)

func TestNativeAuthorizationActionsKeepHelperRunning(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	ledger, err := journal.Open(filepath.Join(t.TempDir(), "state"))
	if err != nil {
		t.Fatal(err)
	}
	defer ledger.Close()
	manager, err := grant.New(ctx, ledger, grant.Owner{DeviceID: "device", MemberID: "member", TeamID: "team"})
	if err != nil {
		t.Fatal(err)
	}
	if err := manager.SetAccountAccess(ctx, grant.AccountAccess{Workdir: t.TempDir()}); err != nil {
		t.Fatal(err)
	}
	service, err := operation.New(ledger, executor.Shell{}, manager.Authorize)
	if err != nil {
		t.Fatal(err)
	}
	local := &connector.LocalSession{DeviceID: "device", Origin: "https://example.com", Grants: manager, Service: service}
	reader, writer, err := os.Pipe()
	if err != nil {
		t.Fatal(err)
	}
	defer reader.Close()
	defer writer.Close()
	output := &nativeAuthorizationOutput{ctx: ctx, locals: []*connector.LocalSession{local}, input: writer}
	// 同一个进程依次暂停和恢复，收到真实状态响应后才继续，最终结果仍单独返回。
	command := exec.CommandContext(ctx, "/bin/sh", "-c", `
 printf '__connector_account__:pause:https://example.com#device\n'
 IFS= read -r paused <&3
 case "$paused" in *'"state":"paused"'*) ;; *) exit 3;; esac
 printf '__connector_account__:resume:https://example.com#device\n'
 IFS= read -r resumed <&3
 case "$resumed" in *'"state":"active"'*) ;; *) exit 4;; esac
 printf 'settings:https://example.com'
 `)
	command.ExtraFiles = []*os.File{reader}
	command.Stdout = output
	if _, err := runNativeHelper(command); err != nil {
		t.Fatal(err)
	}
	if got := output.result.String() + output.buffer.String(); got != "settings:https://example.com" {
		t.Fatalf("unexpected result: %q", got)
	}
	if manager.AccountAccess().Paused {
		t.Fatal("resume did not persist")
	}

	output.buffer.Reset()

	// 分片请求、未知账号及需要另行确认的动作均不得绕过授权流程。
	for _, action := range []string{"remove:" + accountID(local), "enable:" + accountID(local), "pause:missing"} {
		var response bytes.Buffer
		output.input = &response
		output.Write([]byte("__connector_acc"))
		output.Write([]byte("ount__:" + action + "\n"))
		var result struct {
			Error string `json:"error"`
		}
		if err := json.Unmarshal(response.Bytes(), &result); err != nil || result.Error == "" {
			t.Fatalf("invalid action accepted: %s %v", response.String(), err)
		}
		if access := manager.AccountAccess(); access.Paused || access.Removed {
			t.Fatal("invalid action changed authorization")
		}
	}
}
