// Package connector handles one authenticated outbound session; it never opens a listener.
package connector

import (
	"context"
	"encoding/json"
	"errors"
	"fastgpt.local/local-device/internal/transport"
	"net/http"
	"net/url"
	"sync"
	"time"

	"fastgpt.local/local-device/internal/grant"
	"fastgpt.local/local-device/internal/journal"
	"fastgpt.local/local-device/internal/operation"
	"fastgpt.local/local-device/internal/protocol"
	"fastgpt.local/local-device/internal/remoteclock"
	"github.com/coder/websocket"
)

type Options struct {
	RefreshTicket func(context.Context) (ConnectionTicket, error)
	OpenSession   func(context.Context, grant.Owner) (*LocalSession, error)
	HandleGrant   func(context.Context, string, grant.Grant, int64) (grant.Grant, error)
	URL           string
	Ticket        string
	Service       *operation.Service
	HTTPClient    *http.Client
	OnConnected   func()
	Prepare       func(context.Context, operation.Request) (context.Context, operation.Request, context.CancelFunc, error)
}

// Connect requires WSS except explicit loopback development and uses header authentication, not URL tokens. The optional
// HTTP client supports enterprise proxy/custom trust configuration without disabling TLS.
func Connect(ctx context.Context, input Options) error {
	address, err := url.Parse(input.URL)
	if err != nil || !transport.SecureURL(address, "wss", "ws") || address.Host == "" || address.User != nil || address.RawQuery != "" || address.Fragment != "" || input.Ticket == "" || (input.Service == nil && input.OpenSession == nil) {
		return errors.New("invalid_connector_configuration")
	}
	client := input.HTTPClient
	if client == nil {
		client = &http.Client{Timeout: 15 * time.Second}
	}
	// Never forward the bearer ticket through an HTTP redirect to another endpoint.
	safeClient := *client
	safeClient.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	headers := http.Header{"Authorization": []string{"Bearer " + input.Ticket}}
	// The composed session shares one clock between grants and the executor.
	// Legacy callers supplying only a Service cannot advertise that capability.
	if input.OpenSession != nil {
		headers.Set("X-FastGPT-Clock", "server-time-v1")
	}
	socket, _, err := websocket.Dial(ctx, input.URL, &websocket.DialOptions{
		HTTPClient: &safeClient, HTTPHeader: headers,
	})
	if err != nil {
		return errors.New("device_connection_failed")
	}
	defer socket.CloseNow()
	socket.SetReadLimit(protocol.MaxFrameBytes)
	sessionCtx, cancel := context.WithCancel(ctx)
	defer cancel()
	helloCtx, helloCancel := context.WithTimeout(sessionCtx, 10*time.Second)
	kind, data, err := socket.Read(helloCtx)
	helloCancel()
	if err != nil {
		return err
	}
	welcome, err := protocol.Decode(data)
	if err != nil || kind != websocket.MessageText || welcome.Type != "welcome" {
		return errors.New("invalid_gateway_welcome")
	}
	clock := remoteclock.New()
	clock.Observe(welcome.ServerTime)
	var lifetime *ExecutionLifetime
	var generation uint64
	allowGrace := false
	if input.OpenSession != nil {
		if welcome.Owner == nil {
			return errors.New("missing_connection_owner")
		}
		local, err := input.OpenSession(sessionCtx, *welcome.Owner)
		if err != nil {
			return err
		}
		if local == nil || local.Service == nil || local.Grants == nil || (welcome.ServerTime != 0 && local.Clock == nil) {
			return errors.New("invalid_local_session")
		}
		input.Service = local.Service
		if local.Clock != nil {
			clock = local.Clock
			clock.Reset(welcome.ServerTime)
		}
		input.Prepare = local.Grants.Prepare
		input.HandleGrant = local.Control
		lifetime = local.Lifetime
		if lifetime != nil {
			generation, err = lifetime.attach()
			if err != nil {
				return err
			}
			defer func() { lifetime.detach(generation, allowGrace) }()
		}
	}
	if input.OnConnected != nil {
		input.OnConnected()
	}
	var workers sync.WaitGroup
	defer workers.Wait()
	// LIFO: cancel workers before waiting, so closing a connection cannot hang on a command.
	defer cancel()
	authReplies := make(chan protocol.Frame, 1)
	if input.RefreshTicket != nil {
		if welcome.AuthExpiresAt <= clock.Now().UnixMilli() {
			return errors.New("missing_auth_expiry")
		}
		workers.Add(1)
		go func() {
			defer workers.Done()
			defer cancel()
			refreshAuthentication(sessionCtx, socket, welcome, input.RefreshTicket, authReplies, clock)
		}()
	}
	slots := make(chan struct{}, 8)
	type activeCommand struct {
		operationID string
		cancel      context.CancelFunc
	}
	var activeMu sync.Mutex
	active := make(map[string]activeCommand)
	for {
		kind, data, err := socket.Read(sessionCtx)
		if err != nil {
			allowGrace = sessionCtx.Err() == nil && websocket.CloseStatus(err) != websocket.StatusPolicyViolation
			return err
		}
		frame, err := protocol.Decode(data)
		if err != nil || kind != websocket.MessageText || (frame.Type != "auth_refreshed" && frame.Type != "exec_output_query" && frame.Type != "exec_query" && frame.Type != "exec_cancel_query" && frame.Type != "exec_start" && frame.Type != "exec_cancel" && frame.Type != "grant_request" && frame.Type != "grant_renew" && frame.Type != "grant_revoke") || frame.Epoch != welcome.Epoch {
			return errors.New("invalid_gateway_frame")
		}
		// Negotiate once: a capable server must timestamp every frame. Never
		// silently fall back to the desktop wall clock midway through a session.
		if welcome.ServerTime != 0 && frame.ServerTime == 0 {
			return errors.New("missing_server_time")
		}
		clock.Observe(frame.ServerTime)
		if frame.Type == "auth_refreshed" {
			if input.RefreshTicket == nil {
				return errors.New("unexpected_auth_reply")
			}
			select {
			case authReplies <- frame:
			default:
				return errors.New("unexpected_auth_reply")
			}
			continue
		}
		if frame.Type == "exec_cancel" {
			activeMu.Lock()
			if task, ok := active[frame.RequestID]; ok && task.operationID == frame.OperationID {
				task.cancel()
			}
			activeMu.Unlock()
			continue
		}
		select {
		case slots <- struct{}{}:
		default:
			return errors.New("gateway_request_limit")
		}
		taskCtx := sessionCtx
		managedExecution := frame.Type == "exec_start" && lifetime != nil
		finishTask := func() {}
		if frame.Type == "exec_start" {
			var stopTask context.CancelFunc
			if managedExecution {
				taskCtx, stopTask, finishTask, err = lifetime.begin(generation, welcome.Epoch+"/"+frame.RequestID)
				if err != nil {
					return err
				}
			} else {
				taskCtx, stopTask = context.WithCancel(sessionCtx)
			}
			activeMu.Lock()
			if _, exists := active[frame.RequestID]; exists {
				activeMu.Unlock()
				stopTask()
				finishTask()
				return errors.New("duplicate_gateway_request")
			}
			// Register before launching the worker so an immediately following cancel
			// cannot be lost before the command has started.
			active[frame.RequestID] = activeCommand{operationID: frame.OperationID, cancel: stopTask}
			activeMu.Unlock()
		}
		if !managedExecution {
			workers.Add(1)
		}
		go func(frame protocol.Frame) {
			if managedExecution {
				defer finishTask()
			} else {
				defer workers.Done()
			}
			defer func() { <-slots }()
			if frame.Type == "exec_start" {
				defer func() {
					activeMu.Lock()
					active[frame.RequestID].cancel()
					delete(active, frame.RequestID)
					activeMu.Unlock()
				}()
			}
			if frame.Grant != nil {
				response := protocol.Frame{Version: protocol.Version, Epoch: welcome.Epoch, RequestID: frame.RequestID, GrantID: frame.GrantID, Type: "grant_error", Error: "grant_unavailable"}
				if input.HandleGrant != nil {
					controlCtx, stop := context.WithTimeout(sessionCtx, 2*time.Minute)
					value, err := input.HandleGrant(controlCtx, frame.Type, *frame.Grant, frame.LeaseExpiresAt)
					stop()
					if err == nil {
						response.Type = "grant_result"
						response.Error = ""
						response.Grant = &value
					} else {
						response.Error = grantControlError(err)
					}
				}
				encoded, err := json.Marshal(response)
				if err != nil || response.Validate() != nil {
					cancel()
					return
				}
				writeCtx, stop := context.WithTimeout(sessionCtx, 10*time.Second)
				defer stop()
				if socket.Write(writeCtx, websocket.MessageText, encoded) != nil {
					cancel()
				}
				return
			}
			runCtx := taskCtx
			var request operation.Request
			if frame.Request != nil {
				request = *frame.Request
			}
			var preparationError error
			if input.Prepare != nil && frame.Type == "exec_start" {
				var release context.CancelFunc
				runCtx, request, release, preparationError = input.Prepare(taskCtx, request)
				if release != nil {
					defer release()
				}
			}
			response := protocol.Frame{Version: protocol.Version, Epoch: welcome.Epoch, RequestID: frame.RequestID, OperationID: frame.OperationID}
			record, err := func() (journal.Record, error) {
				if frame.OutputQuery != nil {
					page, err := input.Service.ReadOutput(taskCtx, *frame.OutputQuery)
					if err == nil {
						response.Output = &page
					}
					return journal.Record{}, err
				}
				if frame.Query != nil {
					if frame.Type == "exec_cancel_query" {
						return input.Service.Cancel(taskCtx, *frame.Query)
					}
					return input.Service.Lookup(taskCtx, *frame.Query)
				}
				if preparationError != nil {
					return journal.Record{}, preparationError
				}
				return input.Service.Run(runCtx, request)
			}()
			if err != nil {
				response.Type = "exec_error"
				// Do not return arbitrary internal filesystem/SQLite errors over the wire.
				response.Error = "operation_rejected"
				switch err.Error() {
				case "device_busy", "device_paused", "operation_id_conflict", "operation_expired", "grant_revoked", "operation_not_found", "operation_output_unavailable":
					response.Error = err.Error()
				}
			} else if response.Output != nil {
				response.Type = "exec_output"
			} else {
				response.Type = "exec_result"
				response.Record = &record
			}
			encoded, err := json.Marshal(response)
			if err != nil || len(encoded) > protocol.MaxFrameBytes {
				cancel()
				return
			}
			writeCtx, writeCancel := context.WithTimeout(sessionCtx, 10*time.Second)
			defer writeCancel()
			if err = socket.Write(writeCtx, websocket.MessageText, encoded); err != nil {
				cancel()
			}
		}(frame)
	}
}

// grantControlError returns only known public categories, never native paths or internal error text.
func grantControlError(err error) string {
	if errors.Is(err, context.DeadlineExceeded) {
		return "grant_confirmation_timeout"
	}
	switch err.Error() {
	case "local_confirmation_cancelled":
		return "grant_confirmation_cancelled"
	case "local_confirmation_busy":
		return "grant_confirmation_busy"
	case "invalid_local_grant", "invalid_grant_workdir", "local_directory_required":
		return "grant_workdir_invalid"
	case "grant_version_conflict", "grant_scope_mismatch", "local_confirmation_expired":
		return "grant_permission_conflict"
	case "grant_revoked", "grant_unavailable", "grant_expired", "invalid_execution_lease", "account_access_paused", "account_access_removed":
		return err.Error()
	default:
		return "grant_rejected"
	}
}
