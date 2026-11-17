// Package protocol defines bounded messages exchanged only on authenticated connections.
package protocol

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"regexp"

	"fastgpt.local/local-device/internal/executor"
	"fastgpt.local/local-device/internal/grant"
	"fastgpt.local/local-device/internal/journal"
	"fastgpt.local/local-device/internal/operation"
)

const Version = 1
const MaxFrameBytes = 1024*1024 + 4096

var identifier = regexp.MustCompile(`^[A-Za-z0-9_-]{1,128}$`)

type Frame struct {
	Version        int                    `json:"version"`
	Type           string                 `json:"type"`
	Epoch          string                 `json:"epoch"`
	RequestID      string                 `json:"requestId,omitempty"`
	OperationID    string                 `json:"operationId,omitempty"`
	Request        *operation.Request     `json:"request,omitempty"`
	Query          *operation.Query       `json:"query,omitempty"`
	OutputQuery    *operation.OutputQuery `json:"outputQuery,omitempty"`
	Output         *executor.OutputPage   `json:"output,omitempty"`
	Record         *journal.Record        `json:"record,omitempty"`
	Error          string                 `json:"error,omitempty"`
	GrantID        string                 `json:"grantId,omitempty"`
	Grant          *grant.Grant           `json:"grant,omitempty"`
	LeaseExpiresAt int64                  `json:"leaseExpiresAt,omitempty"`
	Owner          *grant.Owner           `json:"owner,omitempty"`
	AuthTicket     string                 `json:"authTicket,omitempty"`
	AuthExpiresAt  int64                  `json:"authExpiresAt,omitempty"`
	ServerTime     int64                  `json:"serverTime,omitempty"`
}

// Decode rejects unknown fields, unsupported versions and concatenated JSON values.
func Decode(data []byte) (Frame, error) {
	var frame Frame
	if len(data) > MaxFrameBytes {
		return frame, errors.New("frame_too_large")
	}
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&frame); err != nil {
		return frame, err
	}
	if err := decoder.Decode(new(any)); err != io.EOF {
		return frame, errors.New("trailing_frame_data")
	}
	return frame, frame.Validate()
}

// Validate checks message shape; authorization and operation semantics remain separate.
func (f Frame) Validate() error {
	if f.ServerTime < 0 {
		return errors.New("invalid_server_time")
	}
	if f.ServerTime != 0 {
		switch f.Type {
		case "welcome", "auth_refreshed", "grant_request", "grant_renew", "grant_revoke", "exec_start", "exec_cancel", "exec_query", "exec_cancel_query", "exec_output_query":
		default:
			return errors.New("unexpected_server_time")
		}
	}
	if f.Version != Version || !identifier.MatchString(f.Epoch) {
		return errors.New("invalid_protocol_header")
	}
	if f.Query != nil && f.Type != "exec_query" && f.Type != "exec_cancel_query" {
		return errors.New("unexpected_query_fields")
	}
	if (f.OutputQuery != nil && f.Type != "exec_output_query") || (f.Output != nil && f.Type != "exec_output") {
		return errors.New("unexpected_output_fields")
	}
	if f.Owner != nil {
		if f.Type != "welcome" || !identifier.MatchString(f.Owner.DeviceID) || !identifier.MatchString(f.Owner.TeamID) || !identifier.MatchString(f.Owner.MemberID) {
			return errors.New("invalid_connection_owner")
		}
	}
	if f.Type == "auth_refresh" || f.Type == "auth_refreshed" {
		if !identifier.MatchString(f.RequestID) || f.OperationID != "" || f.Request != nil || f.Record != nil || f.Error != "" || f.GrantID != "" || f.Grant != nil || f.LeaseExpiresAt != 0 {
			return errors.New("invalid_auth_frame")
		}
		if f.Type == "auth_refresh" {
			if len(f.AuthTicket) != 43 || !identifier.MatchString(f.AuthTicket) || f.AuthExpiresAt != 0 {
				return errors.New("invalid_auth_ticket")
			}
		} else if f.AuthTicket != "" || f.AuthExpiresAt <= 0 {
			return errors.New("invalid_auth_expiry")
		}
		return nil
	}
	if f.AuthTicket != "" || (f.AuthExpiresAt != 0 && f.Type != "welcome") || f.AuthExpiresAt < 0 {
		return errors.New("unexpected_auth_fields")
	}
	if f.Type == "grant_request" || f.Type == "grant_renew" || f.Type == "grant_revoke" || f.Type == "grant_result" || f.Type == "grant_error" {
		if !identifier.MatchString(f.RequestID) || !identifier.MatchString(f.GrantID) || f.OperationID != "" || f.Request != nil || f.Record != nil {
			return errors.New("invalid_grant_frame")
		}
		if f.Type == "grant_error" {
			if f.Grant != nil || f.LeaseExpiresAt != 0 || !identifier.MatchString(f.Error) {
				return errors.New("invalid_grant_error")
			}
			return nil
		}
		if f.Grant == nil || f.Grant.ID != f.GrantID || f.Grant.Version < 1 || f.Error != "" || len(f.Grant.Workdir) > 4096 || len(f.Grant.SourceTarget) > 512 {
			return errors.New("invalid_grant_payload")
		}
		for _, id := range []string{f.Grant.TeamID, f.Grant.MemberID, f.Grant.DeviceID, f.Grant.AppID, f.Grant.ChatID} {
			if !identifier.MatchString(id) {
				return errors.New("invalid_grant_scope")
			}
		}
		if f.Grant.SourceTarget == "" || f.Grant.ExpiresAt < 0 {
			return errors.New("invalid_grant_scope")
		}
		if (f.Type == "grant_renew" && f.LeaseExpiresAt <= 0) || (f.Type != "grant_renew" && f.LeaseExpiresAt != 0) {
			return errors.New("invalid_grant_lease")
		}
		return nil
	}
	if f.GrantID != "" || f.Grant != nil || f.LeaseExpiresAt != 0 {
		return errors.New("unexpected_grant_fields")
	}
	if f.Type == "welcome" {
		if f.RequestID != "" || f.OperationID != "" || f.Request != nil || f.Record != nil || f.Error != "" {
			return errors.New("invalid_welcome")
		}
		return nil
	}
	if !identifier.MatchString(f.RequestID) || !identifier.MatchString(f.OperationID) {
		return errors.New("invalid_request_identity")
	}
	switch f.Type {
	case "exec_output_query":
		q := f.OutputQuery
		if q == nil || q.ID != f.OperationID || !identifier.MatchString(q.GrantID) || q.GrantVersion < 1 || q.Limit < 1 || q.Limit > 64 || q.After > 9007199254740991 || f.Request != nil || f.Record != nil || f.Error != "" {
			return errors.New("invalid_output_query")
		}
	case "exec_output":
		if f.Output == nil || f.Request != nil || f.Record != nil || f.Error != "" || len(f.Output.Events) > 64 || f.Output.Next > 9007199254740991 {
			return errors.New("invalid_output_page")
		}
		var previous uint64
		total := 0
		for _, event := range f.Output.Events {
			total += len(event.Data)
			if event.Sequence <= previous || event.Sequence > f.Output.Next || (event.Stream != "stdout" && event.Stream != "stderr") || len(event.Data) == 0 || len(event.Data) > 4096 || total > 128*1024 {
				return errors.New("invalid_output_event")
			}
			previous = event.Sequence
		}
		if len(f.Output.Events) > 0 && previous != f.Output.Next {
			return errors.New("invalid_output_cursor")
		}
	case "exec_query", "exec_cancel_query":
		if f.Query == nil || f.Query.ID != f.OperationID || !identifier.MatchString(f.Query.GrantID) || f.Query.GrantVersion < 1 || f.Request != nil || f.Record != nil || f.Error != "" {
			return errors.New("invalid_query_frame")
		}
	case "exec_cancel":
		if f.Request != nil || f.Record != nil || f.Error != "" {
			return errors.New("invalid_cancel_frame")
		}
	case "exec_start":
		if f.Request == nil || f.Request.ID != f.OperationID || f.Record != nil || f.Error != "" {
			return errors.New("invalid_exec_frame")
		}
	case "exec_result":
		if f.Request != nil || f.Record == nil || f.Record.ID != f.OperationID || f.Error != "" {
			return errors.New("invalid_result_frame")
		}
	case "exec_error":
		if f.Request != nil || f.Record != nil || !identifier.MatchString(f.Error) {
			return errors.New("invalid_error_frame")
		}
	default:
		return errors.New("unsupported_message_type")
	}
	return nil
}
