package connector

import (
	"context"
	"errors"
	"sync"
	"time"
)

// ExecutionLifetime owns already-started workers across authenticated reconnects.
// The grace window never changes command deadlines or the separate grant lease.
type ExecutionLifetime struct {
	mu        sync.Mutex
	ctx       context.Context
	grace     time.Duration
	epoch     uint64
	connected bool
	closed    bool
	timer     *time.Timer
	tasks     map[string]context.CancelCauseFunc
	workers   sync.WaitGroup
}

// NewExecutionLifetime creates a bounded disconnect window; callers must Close it
// before closing the execution journal. No worker survives the parent context.
func NewExecutionLifetime(ctx context.Context, grace time.Duration) (*ExecutionLifetime, error) {
	if grace <= 0 || grace > 10*time.Second {
		return nil, errors.New("invalid_disconnect_grace")
	}
	return &ExecutionLifetime{ctx: ctx, grace: grace, tasks: make(map[string]context.CancelCauseFunc)}, nil
}

func (l *ExecutionLifetime) attach() (uint64, error) {
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.closed || l.ctx.Err() != nil {
		return 0, errors.New("execution_lifetime_closed")
	}
	if l.timer != nil {
		l.timer.Stop()
		l.timer = nil
	}
	l.epoch++
	l.connected = true
	return l.epoch, nil
}

// detach ignores an old socket's cleanup after a newer authenticated socket attaches.
func (l *ExecutionLifetime) detach(epoch uint64, allowGrace bool) {
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.closed || epoch != l.epoch {
		return
	}
	l.connected = false
	if l.timer != nil {
		l.timer.Stop()
	}
	if !allowGrace {
		for _, cancel := range l.tasks {
			cancel(errors.New("connection_lost"))
		}
		return
	}
	l.timer = time.AfterFunc(l.grace, func() {
		l.mu.Lock()
		defer l.mu.Unlock()
		if l.closed || l.connected || epoch != l.epoch {
			return
		}
		for _, cancel := range l.tasks {
			cancel(errors.New("connection_lost"))
		}
	})
}

func (l *ExecutionLifetime) begin(epoch uint64, key string) (context.Context, context.CancelFunc, func(), error) {
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.closed || !l.connected || epoch != l.epoch || l.ctx.Err() != nil {
		return nil, nil, nil, errors.New("execution_connection_closed")
	}
	if _, exists := l.tasks[key]; exists || len(l.tasks) >= 8 {
		return nil, nil, nil, errors.New("execution_capacity_exceeded")
	}
	ctx, cancel := context.WithCancelCause(l.ctx)
	l.tasks[key] = cancel
	l.workers.Add(1)
	var once sync.Once
	finish := func() {
		once.Do(func() {
			cancel(errors.New("connection_lost"))
			l.mu.Lock()
			delete(l.tasks, key)
			l.mu.Unlock()
			l.workers.Done()
		})
	}
	return ctx, func() { cancel(nil) }, finish, nil
}

// Close cancels and joins all workers before their journal/key resources are released.
func (l *ExecutionLifetime) Close() {
	l.mu.Lock()
	l.closed = true
	l.connected = false
	if l.timer != nil {
		l.timer.Stop()
	}
	for _, cancel := range l.tasks {
		cancel(errors.New("connector_shutdown"))
	}
	l.mu.Unlock()
	l.workers.Wait()
}
