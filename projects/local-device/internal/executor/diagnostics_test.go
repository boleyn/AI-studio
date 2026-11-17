package executor

import (
	"context"
	"errors"
	"runtime"
	"testing"
	"time"
)

// 验证原因码随最终结果保留，未知 context 内容不会泄漏到诊断字段。
func TestCancellationDiagnostics(t *testing.T) {
	command := "sleep 10"
	if runtime.GOOS == "windows" {
		command = "[System.Threading.Thread]::Sleep(10000)"
	}
	for _, cause := range []string{"local_user_stop", "remote_cancel_request", "connection_lost", "connector_shutdown", "grant_revoked", "grant_expired", "execution_lease_expired", "private-path-secret"} {
		t.Run(cause, func(t *testing.T) {
			ctx, cancel := context.WithCancelCause(context.Background())
			timer := time.AfterFunc(200*time.Millisecond, func() { cancel(errors.New(cause)) })
			defer timer.Stop()
			defer cancel(nil)
			result, err := Run(ctx, testShell(t), Request{Command: command, Workdir: t.TempDir(), Timeout: 10 * time.Second})
			want := cause
			if cause == "private-path-secret" {
				want = "cancellation_source_unknown"
			}
			if err != nil || result.Status != "cancelled" || result.TerminationReason != want || result.StartedAt <= 0 || result.FinishedAt < result.StartedAt {
				t.Fatalf("result=%+v error=%v", result, err)
			}
		})
	}
}
