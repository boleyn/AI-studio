package remoteclock

import (
	"testing"
	"time"
)

func TestClockUsesPlatformSampleAndMonotonicElapsed(t *testing.T) {
	c := New()
	if time.Since(c.Now()) > time.Second {
		t.Fatal("legacy clock changed")
	}
	for _, offset := range []time.Duration{-24 * time.Hour, 24 * time.Hour} {
		sample := time.Now().Add(offset).UnixMilli()
		c.Observe(sample)
		if delta := c.Now().UnixMilli() - sample; delta < 0 || delta > 1000 {
			t.Fatalf("desktop skew leaked: %d", delta)
		}
		// Simulate elapsed time without changing the OS wall clock or sleeping.
		c.local = c.local.Add(-2 * time.Second)
		if delta := c.Now().UnixMilli() - sample; delta < 2000 || delta > 3000 {
			t.Fatalf("elapsed time lost: %d", delta)
		}
		before := c.Now()
		c.Observe(sample)
		if c.Now().Before(before) {
			t.Fatal("delayed frame rewound clock")
		}
		c.Observe(0)
		c.Observe(-1)
		if c.Now().Before(before) {
			t.Fatal("invalid sample reset clock")
		}
	}
	c.Reset(0)
	if time.Since(c.Now()) > time.Second {
		t.Fatal("legacy reconnect retained platform offset")
	}
	c.Reset(time.Now().Add(-48 * time.Hour).UnixMilli())
	if time.Since(c.Now()) < 47*time.Hour {
		t.Fatal("reconnect did not reanchor")
	}
}
