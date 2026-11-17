package connector

import (
	"context"
	"testing"
	"time"
)

func TestExecutionLifetimeReconnectAndExpiry(t *testing.T) {
	life, err := NewExecutionLifetime(context.Background(), 40*time.Millisecond)
	if err != nil {
		t.Fatal(err)
	}
	defer life.Close()
	epoch, err := life.attach()
	if err != nil {
		t.Fatal(err)
	}
	ctx, _, finish, err := life.begin(epoch, "task")
	if err != nil {
		t.Fatal(err)
	}
	defer finish()
	life.detach(epoch, true)
	if ctx.Err() != nil {
		t.Fatal("disconnect cancelled immediately")
	}
	if _, _, _, err := life.begin(epoch, "offline"); err == nil {
		t.Fatal("offline execution accepted")
	}
	next, err := life.attach()
	if err != nil {
		t.Fatal(err)
	}
	life.detach(epoch, false)
	select {
	case <-ctx.Done():
		t.Fatal("old connection cancelled resumed command")
	case <-time.After(70 * time.Millisecond):
	}
	if _, _, _, err := life.begin(epoch, "stale"); err == nil {
		t.Fatal("stale connection accepted")
	}
	life.detach(next, true)
	select {
	case <-ctx.Done():
	case <-time.After(time.Second):
		t.Fatal("grace did not expire")
	}
	if _, err := life.attach(); err != nil {
		t.Fatal(err)
	}
	if ctx.Err() == nil {
		t.Fatal("reconnect resurrected expired command")
	}
}

func TestExecutionLifetimeCancellationAndJoin(t *testing.T) {
	for _, parentCancel := range []bool{false, true} {
		parent, cancel := context.WithCancel(context.Background())
		life, err := NewExecutionLifetime(parent, time.Second)
		if err != nil {
			t.Fatal(err)
		}
		epoch, _ := life.attach()
		ctx, _, finish, err := life.begin(epoch, "task")
		if err != nil {
			t.Fatal(err)
		}
		if parentCancel {
			cancel()
		} else {
			life.detach(epoch, false)
		}
		select {
		case <-ctx.Done():
		case <-time.After(time.Second):
			t.Fatal("explicit cancellation ignored")
		}
		joined := make(chan struct{})
		go func() { life.Close(); close(joined) }()
		select {
		case <-joined:
			t.Fatal("closed before worker cleanup")
		case <-time.After(10 * time.Millisecond):
		}
		finish()
		finish()
		select {
		case <-joined:
		case <-time.After(time.Second):
			t.Fatal("worker never joined")
		}
		if _, err := life.attach(); err == nil {
			t.Fatal("closed lifetime reopened")
		}
		cancel()
	}
}

func TestExecutionLifetimeAdmissionLimits(t *testing.T) {
	for _, duration := range []time.Duration{0, -1, 11 * time.Second} {
		if _, err := NewExecutionLifetime(context.Background(), duration); err == nil {
			t.Fatal("invalid grace accepted")
		}
	}
	life, _ := NewExecutionLifetime(context.Background(), time.Second)
	defer life.Close()
	epoch, _ := life.attach()
	for i := 0; i < 8; i++ {
		_, _, finish, err := life.begin(epoch, string(rune('a'+i)))
		if err != nil {
			t.Fatal(err)
		}
		defer finish()
	}
	if _, _, _, err := life.begin(epoch, "extra"); err == nil {
		t.Fatal("unbounded tasks")
	}
	if _, _, _, err := life.begin(epoch, "a"); err == nil {
		t.Fatal("duplicate task")
	}
}
