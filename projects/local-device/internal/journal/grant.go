package journal

import (
	"context"
	"encoding/json"
	"errors"
	"time"
)

// SaveGrant persists only locally confirmed authorization metadata, never a cloud-issued
// assertion of approval. Caller must serialize version checks with this write.
func (j *Journal) SaveGrant(ctx context.Context, id string, data []byte) error {
	if !validID.MatchString(id) || len(data) > 16384 || !json.Valid(data) {
		return errors.New("invalid_local_grant")
	}
	_, err := j.db.ExecContext(ctx, "INSERT INTO local_grants(id,data) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data", id, data)
	return err
}

func (j *Journal) ReadGrants(ctx context.Context) ([][]byte, error) {
	// Keep until-revoked records including revocation tombstones across restarts.
	rows, err := j.db.QueryContext(ctx, "SELECT data FROM local_grants WHERE json_extract(data,'$.expiresAt') = 0 OR json_extract(data,'$.expiresAt') > ? LIMIT 101", time.Now().UnixMilli())
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var result [][]byte
	for rows.Next() {
		var data []byte
		if err = rows.Scan(&data); err != nil {
			return nil, err
		}
		result = append(result, data)
	}
	if len(result) > 100 {
		return nil, errors.New("local_grant_limit")
	}
	return result, rows.Err()
}

// RevokeGrants changes the selected persisted approvals in one transaction. The
// manager supplies only its own restored IDs; no other owner's records are touched.
func (j *Journal) RevokeGrants(ctx context.Context, ids []string) error {
	if len(ids) == 0 {
		return nil
	}
	if len(ids) > 100 {
		return errors.New("local_grant_limit")
	}
	for _, id := range ids {
		if !validID.MatchString(id) {
			return errors.New("invalid_local_grant")
		}
	}
	tx, err := j.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	for _, id := range ids {
		if _, err = tx.ExecContext(ctx, "UPDATE local_grants SET data=json_set(data,'$.revoked',json('true')) WHERE id=?", id); err != nil {
			return err
		}
	}
	return tx.Commit()
}

// ReadGrantHistory includes expired and revoked records retained for this binding.
func (j *Journal) ReadGrantHistory(ctx context.Context, deviceID string) ([][]byte, error) {
	rows, err := j.db.QueryContext(ctx, "SELECT data FROM local_grants WHERE json_extract(data,'$.deviceId')=? ORDER BY rowid DESC", deviceID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var result [][]byte
	for rows.Next() {
		var data []byte
		if err := rows.Scan(&data); err != nil {
			return nil, err
		}
		result = append(result, data)
	}
	return result, rows.Err()
}
