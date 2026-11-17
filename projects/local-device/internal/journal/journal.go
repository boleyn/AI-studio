// Package journal owns the durable, single-connector operation ledger.
package journal

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sync"
	"time"

	_ "modernc.org/sqlite"
)

var validID = regexp.MustCompile(`^[A-Za-z0-9_-]{1,128}$`)
var validDigest = regexp.MustCompile(`^[a-f0-9]{64}$`)

type Record struct {
	ID        string          `json:"operationId"`
	Digest    string          `json:"digest"`
	GrantID   string          `json:"grantId"`
	Status    string          `json:"status"`
	Deadline  int64           `json:"deadline"`
	UpdatedAt int64           `json:"updatedAt"`
	Result    json.RawMessage `json:"result,omitempty"`
}

type Journal struct {
	db            *sql.DB
	unlock        func()
	directory     string
	diagnosticsMu sync.Mutex
}

// Open acquires an OS lock for the lifetime of this connector. Crash recovery changes
// accepted/running to unknown: neither state proves that a process was never started.
func Open(dir string) (*Journal, error) {
	if !filepath.IsAbs(dir) {
		return nil, errors.New("journal_path_must_be_absolute")
	}
	if err := os.MkdirAll(dir, 0700); err != nil {
		return nil, err
	}
	info, err := os.Lstat(dir)
	if err != nil || !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
		return nil, errors.New("invalid_journal_directory")
	}
	unlock, err := lock(filepath.Join(dir, "connector.lock"))
	if err != nil {
		return nil, err
	}
	path := filepath.Join(dir, "operations.sqlite")
	if info, err := os.Lstat(path); err == nil && !info.Mode().IsRegular() {
		unlock()
		return nil, errors.New("invalid_journal_file")
	}
	file, err := os.OpenFile(path, os.O_CREATE|os.O_RDWR, 0600)
	if err != nil {
		unlock()
		return nil, err
	}
	file.Close()
	db, err := sql.Open("sqlite", path)
	if err != nil {
		unlock()
		return nil, err
	}
	db.SetMaxOpenConns(1)
	db.SetMaxIdleConns(1)
	j := &Journal{db: db, unlock: unlock, directory: dir}
	for _, statement := range []string{
		"PRAGMA journal_mode=WAL", "PRAGMA synchronous=FULL", "PRAGMA busy_timeout=5000",
		`CREATE TABLE IF NOT EXISTS operations (
    id TEXT PRIMARY KEY, digest TEXT NOT NULL, grant_id TEXT NOT NULL,
    status TEXT NOT NULL, deadline INTEGER NOT NULL, updated_at INTEGER NOT NULL, result BLOB
  )`,
		"CREATE INDEX IF NOT EXISTS operations_updated_at ON operations(updated_at)",
		`CREATE TABLE IF NOT EXISTS device_bindings (origin TEXT PRIMARY KEY, device_id TEXT NOT NULL, fingerprint TEXT NOT NULL)`,
		`CREATE TABLE IF NOT EXISTS additional_device_bindings (origin TEXT NOT NULL, device_id TEXT NOT NULL, fingerprint TEXT NOT NULL, PRIMARY KEY (origin, device_id))`,
		`CREATE TABLE IF NOT EXISTS account_access (device_id TEXT PRIMARY KEY, data BLOB NOT NULL)`,
		`CREATE TABLE IF NOT EXISTS local_grants (id TEXT PRIMARY KEY, data BLOB NOT NULL)`,
	} {
		if _, err = db.Exec(statement); err != nil {
			j.Close()
			return nil, err
		}
	}
	_, err = db.Exec("UPDATE operations SET status='unknown', updated_at=? WHERE status IN ('accepted','running')", time.Now().UnixMilli())
	if err != nil {
		j.Close()
		return nil, err
	}
	return j, nil
}

// Close releases the OS lock only after SQLite is closed.
func (j *Journal) Close() error {
	err := j.db.Close()
	j.unlock()
	return err
}

// Accept persists before launch. A duplicate returns its existing state, never permission
// to execute again. The caller must check current device/grant/lease authorization first.
func (j *Journal) Accept(ctx context.Context, record Record, now time.Time) (Record, bool, error) {
	if !validID.MatchString(record.ID) || !validID.MatchString(record.GrantID) || !validDigest.MatchString(record.Digest) {
		return Record{}, false, errors.New("invalid_operation")
	}
	if record.Deadline <= now.UnixMilli() || record.Deadline > now.Add(10*time.Minute).UnixMilli() {
		return Record{}, false, errors.New("operation_expired_or_invalid_deadline")
	}
	result, err := j.db.ExecContext(ctx, `INSERT INTO operations(id,digest,grant_id,status,deadline,updated_at)
   VALUES(?,?,?,'accepted',?,?) ON CONFLICT(id) DO NOTHING`, record.ID, record.Digest, record.GrantID, record.Deadline, now.UnixMilli())
	if err != nil {
		return Record{}, false, err
	}
	count, err := result.RowsAffected()
	if err != nil {
		return Record{}, false, err
	}
	stored, err := j.Get(ctx, record.ID)
	if err != nil {
		return Record{}, false, err
	}
	if stored.Digest != record.Digest || stored.GrantID != record.GrantID || stored.Deadline != record.Deadline {
		return Record{}, false, errors.New("operation_id_conflict")
	}
	return stored, count == 1, nil
}

// Get is read-only and does not renew a deadline or restart a command.
func (j *Journal) Get(ctx context.Context, id string) (Record, error) {
	var r Record
	var result []byte
	err := j.db.QueryRowContext(ctx, "SELECT id,digest,grant_id,status,deadline,updated_at,result FROM operations WHERE id=?", id).
		Scan(&r.ID, &r.Digest, &r.GrantID, &r.Status, &r.Deadline, &r.UpdatedAt, &result)
	r.Result = json.RawMessage(result)
	return r, err
}

// MarkRunning is compare-and-set launch intent, persisted before process creation.
// After a crash both accepted and running recover as unknown, never automatically replayed.
func (j *Journal) MarkRunning(ctx context.Context, id string) error {
	result, err := j.db.ExecContext(ctx, "UPDATE operations SET status='running',updated_at=? WHERE id=? AND status='accepted'", time.Now().UnixMilli(), id)
	if err != nil {
		return err
	}
	count, err := result.RowsAffected()
	if err == nil && count != 1 {
		return errors.New("invalid_operation_transition")
	}
	return err
}

// Finish stores a bounded JSON result without allowing terminal records to be overwritten.
func (j *Journal) Finish(ctx context.Context, id, status string, result json.RawMessage) error {
	switch status {
	case "completed", "failed", "cancelled", "timed_out", "unknown":
	default:
		return errors.New("invalid_terminal_status")
	}
	if len(result) > 1024*1024 || !json.Valid(result) {
		return errors.New("invalid_operation_result")
	}
	updated, err := j.db.ExecContext(ctx, `UPDATE operations SET status=?,updated_at=?,result=?
   WHERE id=? AND status IN ('accepted','running')`, status, time.Now().UnixMilli(), []byte(result), id)
	if err != nil {
		return err
	}
	count, err := updated.RowsAffected()
	if err == nil && count != 1 {
		return fmt.Errorf("invalid_operation_transition: %s", id)
	}
	return err
}

// Prune drops detailed output after 24 hours, retaining dedup tombstones for seven days.
// Only expired, terminal operations can be removed; expired envelopes must still be rejected.
func (j *Journal) Prune(ctx context.Context, now time.Time) error {
	_, err := j.db.ExecContext(ctx, `UPDATE operations SET result=NULL WHERE updated_at<?
   AND status NOT IN ('accepted','running')`, now.Add(-24*time.Hour).UnixMilli())
	if err != nil {
		return err
	}
	_, err = j.db.ExecContext(ctx, `DELETE FROM operations WHERE updated_at<? AND deadline<?
   AND status NOT IN ('accepted','running')`, now.Add(-7*24*time.Hour).UnixMilli(), now.UnixMilli())
	return err
}
