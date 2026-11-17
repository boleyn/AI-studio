// Package remoteclock interprets authenticated platform deadlines without trusting
// the desktop wall clock. Between frames, elapsed time comes from Go's monotonic clock.
package remoteclock

import (
	"sync"
	"time"
)

type Clock struct {
	mu     sync.RWMutex
	remote time.Time
	local  time.Time
}

// New preserves legacy local-time behavior until an authenticated server sample arrives.
func New() *Clock { return &Clock{} }

// Observe anchors platform time at receipt. Network transit is deliberately tolerated;
// it cannot create approval or increase a lease's advertised maximum duration.
func (c *Clock) Observe(serverTime int64) {
	if serverTime <= 0 {
		return
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	remote, local := time.UnixMilli(serverTime), time.Now()
	// Delayed frames must age against the existing anchor, never reset the clock
	// backwards and revive a stale lease/command. A reconnect explicitly reanchors.
	if !c.local.IsZero() && remote.Before(c.remote.Add(local.Sub(c.local))) {
		return
	}
	c.remote, c.local = remote, local
}

// Reset starts a newly authenticated connection's time domain. Zero explicitly
// selects legacy behavior; normal frame observations cannot disable platform time.
func (c *Clock) Reset(serverTime int64) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.remote, c.local = time.Time{}, time.Time{}
	if serverTime > 0 {
		c.remote, c.local = time.UnixMilli(serverTime), time.Now()
	}
}

// Now advances the latest platform sample using monotonic elapsed time, so local
// timezone changes, manual clock adjustment and clock skew do not alter deadlines.
func (c *Clock) Now() time.Time {
	c.mu.RLock()
	defer c.mu.RUnlock()
	if c.local.IsZero() {
		return time.Now()
	}
	return c.remote.Add(time.Since(c.local))
}
