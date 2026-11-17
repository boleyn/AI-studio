package journal

import (
	"context"
	"errors"
	"fastgpt.local/local-device/internal/transport"
	"net/url"
)

type Binding struct {
	Origin      string
	DeviceID    string
	Fingerprint string
}

// ForgetBinding is an explicit local re-pair action while the journal's exclusive
// process lock is held and no execution is active. Only this platform's associations
// and approvals are removed; operation history and other origins remain intact.
func (j *Journal) ForgetBinding(ctx context.Context, origin string) error {
	tx, err := j.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err := tx.ExecContext(ctx, `DELETE FROM local_grants WHERE json_extract(data,'$.deviceId') IN (
		SELECT device_id FROM device_bindings WHERE origin=?
		UNION ALL SELECT device_id FROM additional_device_bindings WHERE origin=?
	)`, origin, origin); err != nil {
		return err
	}
	for _, query := range []string{"DELETE FROM device_bindings WHERE origin=?", "DELETE FROM additional_device_bindings WHERE origin=?"} {
		if _, err := tx.ExecContext(ctx, query, origin); err != nil {
			return err
		}
	}
	return tx.Commit()
}

// Binding reads only non-secret platform association metadata. A new private key must
// never silently reuse an old device ID after a failed secure-store restore.
func (j *Journal) Binding(ctx context.Context, origin string) (Binding, error) {
	var value Binding
	err := j.db.QueryRowContext(ctx, "SELECT origin,device_id,fingerprint FROM device_bindings WHERE origin=?", origin).Scan(&value.Origin, &value.DeviceID, &value.Fingerprint)
	return value, err
}

func validateBinding(value Binding) error {
	u, err := url.Parse(value.Origin)
	if err != nil || !transport.SecureURL(u, "https", "http") || u.Host == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" || u.Path != "" || !validID.MatchString(value.DeviceID) || !validDigest.MatchString(value.Fingerprint) {
		return errors.New("invalid_device_binding")
	}
	return nil
}

// SaveBinding publishes the initial association without replacing an existing identity.
func (j *Journal) SaveBinding(ctx context.Context, value Binding) error {
	if err := validateBinding(value); err != nil {
		return err
	}
	_, err := j.db.ExecContext(ctx, "INSERT INTO device_bindings(origin,device_id,fingerprint) VALUES(?,?,?) ON CONFLICT(origin) DO NOTHING", value.Origin, value.DeviceID, value.Fingerprint)
	if err != nil {
		return err
	}
	actual, err := j.Binding(ctx, value.Origin)
	if err != nil {
		return err
	}
	if actual != value {
		return errors.New("device_binding_conflict")
	}
	return nil
}

// Bindings returns the legacy primary identity followed by additional identities for this platform.
func (j *Journal) Bindings(ctx context.Context, origin string) ([]Binding, error) {
	rows, err := j.db.QueryContext(ctx, `SELECT origin,device_id,fingerprint FROM (
		SELECT origin,device_id,fingerprint,0 AS priority FROM device_bindings WHERE origin=?
		UNION ALL SELECT origin,device_id,fingerprint,1 FROM additional_device_bindings WHERE origin=?
	) ORDER BY priority,device_id`, origin, origin)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var result []Binding
	for rows.Next() {
		var binding Binding
		if err := rows.Scan(&binding.Origin, &binding.DeviceID, &binding.Fingerprint); err != nil {
			return nil, err
		}
		result = append(result, binding)
	}
	return result, rows.Err()
}

// AddBinding persists a redeemed identity without replacing another account's binding.
func (j *Journal) AddBinding(ctx context.Context, value Binding) error {
	if err := validateBinding(value); err != nil {
		return err
	}
	_, err := j.db.ExecContext(ctx, `INSERT INTO additional_device_bindings(origin,device_id,fingerprint)
		SELECT ?,?,? WHERE NOT EXISTS (SELECT 1 FROM device_bindings WHERE origin=? AND device_id=?)
		ON CONFLICT(origin,device_id) DO NOTHING`, value.Origin, value.DeviceID, value.Fingerprint, value.Origin, value.DeviceID)
	return err
}

// ForgetDevice removes one revoked identity and its approvals, preserving other accounts.
func (j *Journal) ForgetDevice(ctx context.Context, origin, deviceID string) error {
	tx, err := j.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	for _, query := range []string{"DELETE FROM device_bindings WHERE origin=? AND device_id=?", "DELETE FROM additional_device_bindings WHERE origin=? AND device_id=?"} {
		if _, err := tx.ExecContext(ctx, query, origin, deviceID); err != nil {
			return err
		}
	}
	if _, err := tx.ExecContext(ctx, "DELETE FROM local_grants WHERE json_extract(data,'$.deviceId')=?", deviceID); err != nil {
		return err
	}
	return tx.Commit()
}
