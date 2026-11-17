package journal

import (
	"context"
	"database/sql"
	"errors"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestBindingPersistenceAndConflict(t *testing.T) {
	directory := filepath.Join(t.TempDir(), "state")
	j, err := Open(directory)
	if err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	value := Binding{Origin: "https://platform.example", DeviceID: "device", Fingerprint: strings.Repeat("a", 64)}
	if _, err = j.Binding(ctx, value.Origin); !errors.Is(err, sql.ErrNoRows) {
		t.Fatal(err)
	}
	if err = j.SaveBinding(ctx, value); err != nil {
		t.Fatal(err)
	}
	if err = j.SaveBinding(ctx, value); err != nil {
		t.Fatal(err)
	}
	conflict := value
	conflict.DeviceID = "other"
	if err = j.SaveBinding(ctx, conflict); err == nil {
		t.Fatal("binding overwritten")
	}
	if err := j.AddBinding(ctx, conflict); err != nil {
		t.Fatal(err)
	}
	if err = j.Close(); err != nil {
		t.Fatal(err)
	}
	j, err = Open(directory)
	if err != nil {
		t.Fatal(err)
	}
	defer j.Close()
	actual, err := j.Binding(ctx, value.Origin)
	if err != nil || actual != value {
		t.Fatalf("%v %v", actual, err)
	}
	bindings, err := j.Bindings(ctx, value.Origin)
	if err != nil || len(bindings) != 2 || bindings[0] != value || bindings[1] != conflict {
		t.Fatalf("additional binding not restored: %v %v", bindings, err)
	}
	for _, origin := range []string{"ftp://platform", "https://user:pass@platform", "https://platform?token=x"} {
		invalid := value
		invalid.Origin = origin
		if err = j.SaveBinding(ctx, invalid); err == nil {
			t.Fatal("invalid origin accepted")
		}
	}
}

func TestExplicitRePairForgetsOnlySelectedBinding(t *testing.T) {
	ctx := context.Background()
	directory := filepath.Join(t.TempDir(), "state")
	j, err := Open(directory)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { j.Close() }()
	for _, value := range []Binding{
		{Origin: "https://first.example", DeviceID: "first", Fingerprint: strings.Repeat("a", 64)},
		{Origin: "https://other.example", DeviceID: "other", Fingerprint: strings.Repeat("b", 64)},
	} {
		if err := j.SaveBinding(ctx, value); err != nil {
			t.Fatal(err)
		}
	}
	if err := j.SaveGrant(ctx, "first-grant", []byte(`{"deviceId":"first","expiresAt":9999999999999}`)); err != nil {
		t.Fatal(err)
	}
	if err := j.SaveGrant(ctx, "other-grant", []byte(`{"deviceId":"other","expiresAt":9999999999999}`)); err != nil {
		t.Fatal(err)
	}
	if _, _, err := j.Accept(ctx, Record{ID: "history", GrantID: "first-grant", Digest: strings.Repeat("a", 64), Deadline: time.Now().Add(time.Minute).UnixMilli()}, time.Now()); err != nil {
		t.Fatal(err)
	}
	cancelled, cancel := context.WithCancel(ctx)
	cancel()
	if err := j.ForgetBinding(cancelled, "https://first.example"); err == nil {
		t.Fatal("cancel ignored")
	}
	if _, err := j.Binding(ctx, "https://first.example"); err != nil {
		t.Fatal("cancel removed binding")
	}
	for i := 0; i < 2; i++ {
		if err := j.ForgetBinding(ctx, "https://first.example"); err != nil {
			t.Fatal(err)
		}
	}
	if err := j.Close(); err != nil {
		t.Fatal(err)
	}
	j, err = Open(directory)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := j.Binding(ctx, "https://first.example"); !errors.Is(err, sql.ErrNoRows) {
		t.Fatal("forgotten binding restored")
	}
	if _, err := j.Binding(ctx, "https://other.example"); err != nil {
		t.Fatal("other binding lost")
	}
	grants, err := j.ReadGrants(ctx)
	if err != nil || len(grants) != 1 || !strings.Contains(string(grants[0]), "other") {
		t.Fatal("wrong approvals removed")
	}
	if _, err := j.Get(ctx, "history"); err != nil {
		t.Fatal("execution history removed")
	}
}
