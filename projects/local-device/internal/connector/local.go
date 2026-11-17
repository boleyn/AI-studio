package connector

import (
	"context"
	"errors"
	"log"
	"sync"
	"time"

	"fastgpt.local/local-device/internal/executor"
	"fastgpt.local/local-device/internal/grant"
	"fastgpt.local/local-device/internal/journal"
	"fastgpt.local/local-device/internal/operation"
	"fastgpt.local/local-device/internal/remoteclock"
)

// LocalSession composes the durable executor and local approval manager. The desktop
// controller uses Service for pause/stop; cloud messages can never invoke those controls.
type LocalSession struct {
	Clock      *remoteclock.Clock
	DeviceID   string
	Origin     string
	Disconnect context.CancelFunc
	Lifetime   *ExecutionLifetime
	Service    *operation.Service
	Grants     *grant.Manager
	Control    func(context.Context, string, grant.Grant, int64) (grant.Grant, error)
}

type LocalOptions struct {
	AccountMode bool
	Lifetime    *ExecutionLifetime
	DeviceID    string
	Journal     *journal.Journal
	Shell       executor.Shell
	Confirm     func(context.Context, grant.Grant) (string, error)
}

// NewLocalSessionFactory waits for the authenticated welcome before constructing the
// owner-scoped manager. Reconnect reuses the same executor (including local pause),
// and a changed device/team/member cannot silently inherit the previous approval.
func NewLocalSessionFactory(input LocalOptions) (func(context.Context, grant.Owner) (*LocalSession, error), error) {
	if input.DeviceID == "" || input.Journal == nil || (!input.AccountMode && input.Confirm == nil) {
		return nil, errors.New("invalid_local_configuration")
	}
	var mu sync.Mutex
	var current *LocalSession
	var bound grant.Owner
	return func(ctx context.Context, owner grant.Owner) (*LocalSession, error) {
		mu.Lock()
		defer mu.Unlock()
		if owner.DeviceID != input.DeviceID {
			return nil, errors.New("connection_device_mismatch")
		}
		if current != nil {
			if bound != owner {
				return nil, errors.New("connection_owner_changed")
			}
			return current, nil
		}
		clock := remoteclock.New()
		manager, err := grant.New(ctx, input.Journal, owner, clock)
		if err != nil {
			return nil, err
		}
		service, err := operation.New(input.Journal, input.Shell, manager.Authorize, clock)
		if err != nil {
			return nil, err
		}
		confirm := input.Confirm
		if input.AccountMode && confirm != nil {
			confirm = func(ctx context.Context, value grant.Grant) (string, error) {
				if value.Display == nil || value.Display.InitialWorkdir == "" {
					return "", errors.New("local_confirmation_required")
				}
				return input.Confirm(ctx, value)
			}
		}
		control := manager.ControlHandler(confirm)
		// 授权失败发生在执行之前，记录安全分类，便于与命令执行错误区分。
		controlWithDiagnostics := func(ctx context.Context, stage string, value grant.Grant, leaseExpiresAt int64) (grant.Grant, error) {
			result, err := control(ctx, stage, value, leaseExpiresAt)
			if err != nil {
				now := time.Now().UnixMilli()
				remaining := int64(0)
				if stage == "grant_renew" {
					remaining = leaseExpiresAt - clock.Now().UnixMilli()
				}
				diagnostic := journal.GrantDiagnostic{Timestamp: now, Stage: stage, Code: grantControlError(err), GrantID: value.ID, GrantVersion: value.Version, LeaseRemainingMs: remaining}
				log.Printf("grant control failed stage=%s code=%s grantId=%s grantVersion=%d leaseRemainingMs=%d", diagnostic.Stage, diagnostic.Code, diagnostic.GrantID, diagnostic.GrantVersion, diagnostic.LeaseRemainingMs)
				if input.Journal.RecordGrantDiagnostic(diagnostic) != nil {
					log.Print("grant diagnostic persistence failed")
				}
			}
			return result, err
		}
		current = &LocalSession{Clock: clock, DeviceID: input.DeviceID, Service: service, Grants: manager, Control: controlWithDiagnostics, Lifetime: input.Lifetime}
		bound = owner
		return current, nil
	}, nil
}
