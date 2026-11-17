package journal

import (
	"context"
	"database/sql"
	"errors"
)

// AccountAccess reads local execution policy independently of the platform's binding.
func (j *Journal) AccountAccess(ctx context.Context, deviceID string) ([]byte, error) {
	var raw []byte
	err := j.db.QueryRowContext(ctx, "SELECT data FROM account_access WHERE device_id=?", deviceID).Scan(&raw)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	return raw, err
}

// SaveAccountAccess replaces only this device binding's local execution policy.
func (j *Journal) SaveAccountAccess(ctx context.Context, deviceID string, raw []byte) error {
	_, err := j.db.ExecContext(ctx, "INSERT INTO account_access(device_id,data) VALUES(?,?) ON CONFLICT(device_id) DO UPDATE SET data=excluded.data", deviceID, raw)
	return err
}
