package journal

import (
	"context"
	"encoding/json"
	"fmt"
	"path/filepath"
	"testing"
	"time"
)

func TestRevokeGrantsIsScopedAndValidatesBeforeWriting(t *testing.T) {
	j, err := Open(filepath.Join(t.TempDir(), "state"))
	if err != nil {
		t.Fatal(err)
	}
	defer j.Close()
	ctx := context.Background()
	for _, id := range []string{"one", "two", "other-owner"} {
		data := json.RawMessage(fmt.Sprintf(`{"grantId":%q,"revoked":false,"expiresAt":%d}`, id, time.Now().Add(time.Hour).UnixMilli()))
		if err := j.SaveGrant(ctx, id, data); err != nil {
			t.Fatal(err)
		}
	}
	if err := j.RevokeGrants(ctx, []string{"one", "bad id"}); err == nil {
		t.Fatal("invalid ID accepted")
	}
	if err := j.RevokeGrants(ctx, make([]string, 101)); err == nil {
		t.Fatal("unbounded revocation accepted")
	}
	if err := j.RevokeGrants(ctx, nil); err != nil {
		t.Fatal(err)
	}
	if err := j.RevokeGrants(ctx, []string{"one", "two"}); err != nil {
		t.Fatal(err)
	}
	records, err := j.ReadGrants(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(records) != 3 {
		t.Fatal("records disappeared")
	}
	for _, raw := range records {
		var value struct {
			ID      string `json:"grantId"`
			Revoked bool   `json:"revoked"`
		}
		if err := json.Unmarshal(raw, &value); err != nil {
			t.Fatal(err)
		}
		if value.Revoked != (value.ID != "other-owner") {
			t.Fatalf("unexpected revocation: %+v", value)
		}
	}
}
