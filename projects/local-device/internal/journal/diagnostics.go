package journal

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
)

const diagnosticLimit = 1024 * 1024

// GrantDiagnostic 只保存授权控制阶段和安全原因码，不接受命令、路径、输出或凭据。
type GrantDiagnostic struct {
	Timestamp        int64  `json:"timestamp"`
	Stage            string `json:"stage"`
	Code             string `json:"code"`
	GrantID          string `json:"grantId"`
	GrantVersion     int64  `json:"grantVersion"`
	LeaseRemainingMs int64  `json:"leaseRemainingMs"`
}

// RecordGrantDiagnostic 将失败写入本机 JSONL，达到 1 MiB 后重新记录，避免长期堆积。
// 调用方只能传入归类后的原因码；诊断写入失败不能改变原授权结果。
func (j *Journal) RecordGrantDiagnostic(value GrantDiagnostic) error {
	if (value.Stage != "grant_request" && value.Stage != "grant_renew" && value.Stage != "grant_revoke") || !validID.MatchString(value.Code) || !validID.MatchString(value.GrantID) {
		return errors.New("invalid_grant_diagnostic")
	}
	data, err := json.Marshal(value)
	if err != nil {
		return err
	}
	j.diagnosticsMu.Lock()
	defer j.diagnosticsMu.Unlock()
	path := filepath.Join(j.directory, "grant-diagnostics.jsonl")
	flags := os.O_CREATE | os.O_WRONLY | os.O_APPEND
	info, err := os.Lstat(path)
	if err == nil {
		if !info.Mode().IsRegular() {
			return errors.New("invalid_diagnostic_file")
		}
		if info.Size()+int64(len(data)+1) > diagnosticLimit {
			flags = os.O_CREATE | os.O_WRONLY | os.O_TRUNC
		}
	} else if !errors.Is(err, os.ErrNotExist) {
		return err
	}
	file, err := os.OpenFile(path, flags, 0600)
	if err != nil {
		return err
	}
	defer file.Close()
	_, err = file.Write(append(data, '\n'))
	return err
}
