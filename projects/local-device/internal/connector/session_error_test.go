package connector

import (
	"context"
	"errors"
	"testing"
)

func TestGrantControlErrorKeepsFailureCategories(t *testing.T) {
	for _, test := range []struct {
		err  error
		code string
	}{
		{context.DeadlineExceeded, "grant_confirmation_timeout"},
		{errors.New("local_confirmation_cancelled"), "grant_confirmation_cancelled"},
		{errors.New("local_confirmation_busy"), "grant_confirmation_busy"},
		{errors.New("invalid_grant_workdir"), "grant_workdir_invalid"},
		{errors.New("grant_version_conflict"), "grant_permission_conflict"},
		{errors.New("grant_scope_mismatch"), "grant_permission_conflict"},
		{errors.New("grant_revoked"), "grant_revoked"},
		{errors.New("grant_unavailable"), "grant_unavailable"},
		{errors.New("grant_expired"), "grant_expired"},
		{errors.New("invalid_execution_lease"), "invalid_execution_lease"},
		{errors.New("account_access_paused"), "account_access_paused"},
		{errors.New("account_access_removed"), "account_access_removed"},
		{errors.New("/private/internal/path"), "grant_rejected"},
	} {
		if got := grantControlError(test.err); got != test.code {
			t.Fatalf("got %s want %s", got, test.code)
		}
	}
}
