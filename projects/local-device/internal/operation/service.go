// Package operation connects the durable ledger to the native executor.
package operation

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"log"
	"regexp"
	"sync"
	"time"

	"fastgpt.local/local-device/internal/executor"
	"fastgpt.local/local-device/internal/journal"
	"fastgpt.local/local-device/internal/remoteclock"
)

type Request struct {
	ID           string `json:"operationId"`
	GrantID      string `json:"grantId"`
	GrantVersion int64  `json:"grantVersion"`
	Deadline     int64  `json:"deadline"`
	Command      string `json:"command"`
	Workdir      string `json:"workdir"`
	TimeoutMs    int64  `json:"timeoutMs"`
}

// Query contains authorization scope only; it cannot carry a command or extend its deadline.
type Query struct {
	ID           string `json:"operationId"`
	GrantID      string `json:"grantId"`
	GrantVersion int64  `json:"grantVersion"`
}

type OutputQuery struct {
	Query
	After uint64 `json:"after"`
	Limit int    `json:"limit"`
}

var validQueryID = regexp.MustCompile(`^[A-Za-z0-9_-]{1,128}$`)

type Service struct {
	clock       *remoteclock.Clock
	journal     *journal.Journal
	shell       executor.Shell
	authorize   func(Request) error
	slot        chan struct{}
	mu          sync.Mutex
	paused      bool
	active      context.CancelFunc
	activeCause context.CancelCauseFunc
	activeID    string
	outputID    string
	output      *executor.OutputStream
}

// New requires the local grant validator. Network callers may not construct an executor
// without one; the parent context must also be cancelled when its execution lease expires.
func New(ledger *journal.Journal, shell executor.Shell, authorize func(Request) error, clocks ...*remoteclock.Clock) (*Service, error) {
	if ledger == nil || authorize == nil {
		return nil, errors.New("operation_authorizer_required")
	}
	clock := remoteclock.New()
	if len(clocks) > 0 && clocks[0] != nil {
		clock = clocks[0]
	}
	return &Service{clock: clock, journal: ledger, shell: shell, authorize: authorize, slot: make(chan struct{}, 1)}, nil
}

// SetPaused is a local user control. Pausing rejects new executions but leaves the
// current command and its lease monitor running; resuming never replays a command.
func (s *Service) SetPaused(paused bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.paused = paused
}

// HasActive reports local execution state for the tray without exposing command contents.
func (s *Service) HasActive() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.active != nil
}

// StopActive requests cancellation of the current process group without revoking
// session approval. The execution result, not this return value, confirms termination.
func (s *Service) StopActive() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.active == nil {
		return false
	}
	s.active()
	return true
}

// Cancel targets a durable operation, not a socket request or whichever task is current.
// The returned record is an observation, not confirmation that termination has finished.
func (s *Service) Cancel(ctx context.Context, query Query) (journal.Record, error) {
	record, err := s.Lookup(ctx, query)
	if err != nil {
		return journal.Record{}, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := ctx.Err(); err != nil {
		return journal.Record{}, err
	}
	if s.active != nil && s.activeID == query.ID {
		if s.activeCause != nil {
			s.activeCause(errors.New("remote_cancel_request"))
		} else {
			s.active()
		}
	}
	return record, nil
}

// Lookup reads an existing operation without starting/retrying it, even after its deadline.
// A currently valid local grant/lease is still required. Unknown IDs and a different grant
// have the same response so an authorized session cannot enumerate another session's output.
func (s *Service) Lookup(ctx context.Context, query Query) (journal.Record, error) {
	if !validQueryID.MatchString(query.ID) || !validQueryID.MatchString(query.GrantID) || query.GrantVersion < 1 {
		return journal.Record{}, errors.New("invalid_operation_query")
	}
	request := Request{ID: query.ID, GrantID: query.GrantID, GrantVersion: query.GrantVersion}
	if err := s.authorize(request); err != nil {
		return journal.Record{}, err
	}
	record, err := s.journal.Get(ctx, query.ID)
	if errors.Is(err, sql.ErrNoRows) || (err == nil && record.GrantID != query.GrantID) {
		return journal.Record{}, errors.New("operation_not_found")
	}
	if err != nil {
		return journal.Record{}, err
	}
	// Revocation may race the disk read; do not release a saved output after a known revocation.
	if err := s.authorize(request); err != nil {
		return journal.Record{}, err
	}
	return record, nil
}

// ReadOutput reads bounded in-memory output for the latest execution, never launching it.
// Every page requires a current grant. A restart or newer execution discards replay;
// callers must use Lookup for the durable final result, not retry the command.
func (s *Service) ReadOutput(ctx context.Context, query OutputQuery) (executor.OutputPage, error) {
	if _, err := s.Lookup(ctx, query.Query); err != nil {
		return executor.OutputPage{}, err
	}
	s.mu.Lock()
	stream := s.output
	if s.outputID != query.ID {
		stream = nil
	}
	s.mu.Unlock()
	if stream == nil {
		return executor.OutputPage{}, errors.New("operation_output_unavailable")
	}
	page := stream.Read(query.After, query.Limit)
	if err := ctx.Err(); err != nil {
		return executor.OutputPage{}, err
	}
	// Authorization can change while copying a page, independently of the service lock.
	if err := s.authorize(Request{ID: query.ID, GrantID: query.GrantID, GrantVersion: query.GrantVersion}); err != nil {
		return executor.OutputPage{}, err
	}
	return page, nil
}

// Run returns existing state for duplicate IDs. It never auto-retries a command or
// overwrites an unknown/terminal result, even after a connector restart.
func (s *Service) Run(ctx context.Context, request Request) (journal.Record, error) {
	if err := s.authorize(request); err != nil {
		return journal.Record{}, err
	}
	if request.GrantVersion < 1 || request.TimeoutMs < 1 || request.TimeoutMs > 600000 {
		return journal.Record{}, errors.New("invalid_operation_request")
	}
	now := s.clock.Now()
	if request.Deadline <= now.UnixMilli() || request.Deadline > now.Add(10*time.Minute).UnixMilli() {
		return journal.Record{}, errors.New("operation_expired")
	}
	encoded, err := json.Marshal(struct {
		Request Request
		Shell   executor.Shell
	}{request, s.shell})
	if err != nil {
		return journal.Record{}, err
	}
	hash := sha256.Sum256(encoded)
	digest := hex.EncodeToString(hash[:])
	stored, err := s.journal.Get(ctx, request.ID)
	if err == nil {
		if stored.Digest != digest {
			return journal.Record{}, errors.New("operation_id_conflict")
		}
		return stored, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return journal.Record{}, err
	}
	// Capacity is reserved before acceptance, so a busy response never leaves a queued command.
	select {
	case s.slot <- struct{}{}:
		defer func() { <-s.slot }()
	default:
		return journal.Record{}, errors.New("device_busy")
	}
	// Admission and local pause/stop share one lock: stop cannot miss an accepted
	// task between its final admission check and registering its cancellation handle.
	s.mu.Lock()
	if s.paused {
		s.mu.Unlock()
		return journal.Record{}, errors.New("device_paused")
	}
	ctx, stop := context.WithCancelCause(ctx)
	s.active = func() { stop(errors.New("local_user_stop")) }
	s.activeCause = stop
	s.activeID = request.ID
	s.mu.Unlock()
	defer func() {
		s.mu.Lock()
		s.active = nil
		s.activeCause = nil
		s.activeID = ""
		stop(nil)
		s.mu.Unlock()
	}()
	if err := ctx.Err(); err != nil {
		return journal.Record{}, err
	}
	if err := s.authorize(request); err != nil {
		return journal.Record{}, err
	}
	record, fresh, err := s.journal.Accept(ctx, journal.Record{
		ID: request.ID, Digest: digest, GrantID: request.GrantID, Deadline: request.Deadline,
	}, s.clock.Now())
	if err != nil || !fresh {
		return record, err
	}
	// Mark intent before launch. A crash in this window intentionally recovers as unknown,
	// rather than guessing that it is safe to execute the command a second time.
	if err = s.journal.MarkRunning(ctx, request.ID); err != nil {
		return record, err
	}
	stream := &executor.OutputStream{}
	s.mu.Lock()
	s.outputID, s.output = request.ID, stream
	s.mu.Unlock()
	// Keep the original server deadline in the durable record/digest, but enforce
	// its remaining duration with a local monotonic timer.
	runCtx, cancel := context.WithTimeout(ctx, time.UnixMilli(request.Deadline).Sub(s.clock.Now()))
	defer cancel()
	result, runErr := executor.Run(runCtx, s.shell, executor.Request{
		Command: request.Command, Workdir: request.Workdir, Timeout: time.Duration(request.TimeoutMs) * time.Millisecond,
		Output: stream,
	})
	log.Printf("operation finished operationId=%s grantId=%s status=%s terminationReason=%s startedAt=%d finishedAt=%d deadline=%d", request.ID, request.GrantID, result.Status, result.TerminationReason, result.StartedAt, result.FinishedAt, request.Deadline)
	payload, err := json.Marshal(struct {
		executor.Result
		Error string `json:"error,omitempty"`
	}{Result: result, Error: func() string {
		if runErr != nil {
			return runErr.Error()
		}
		return ""
	}()})
	if err != nil {
		return record, err
	}
	// Cancellation must not cancel persisting the final outcome. Bound the cleanup write.
	persistCtx, persistCancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer persistCancel()
	if err = s.journal.Finish(persistCtx, request.ID, result.Status, payload); err != nil {
		return record, err
	}
	return s.journal.Get(persistCtx, request.ID)
}
