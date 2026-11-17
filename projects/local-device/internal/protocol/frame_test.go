package protocol

import (
	"encoding/json"
	"strings"
	"testing"

	"fastgpt.local/local-device/internal/grant"
	"fastgpt.local/local-device/internal/journal"
	"fastgpt.local/local-device/internal/operation"
)

func TestFrames(t *testing.T) {
	for _, f := range []Frame{
		{Version: 1, Type: "welcome", Epoch: "epoch"},
		{Version: 1, Type: "welcome", Epoch: "epoch", ServerTime: 123},
		{Version: 1, Type: "exec_query", Epoch: "epoch", RequestID: "query", OperationID: "op", Query: &operation.Query{ID: "op", GrantID: "grant", GrantVersion: 1}},
		{Version: 1, Type: "exec_cancel_query", Epoch: "epoch", RequestID: "cancel", OperationID: "op", Query: &operation.Query{ID: "op", GrantID: "grant", GrantVersion: 1}},
		{Version: 1, Type: "welcome", Epoch: "epoch", AuthExpiresAt: 123},
		{Version: 1, Type: "auth_refresh", Epoch: "epoch", RequestID: "refresh_1", AuthTicket: strings.Repeat("t", 43)},
		{Version: 1, Type: "auth_refreshed", Epoch: "epoch", RequestID: "refresh_1", AuthExpiresAt: 123},
		{Version: 1, Type: "welcome", Epoch: "epoch", Owner: &grant.Owner{DeviceID: "device", TeamID: "team", MemberID: "member"}},
		{Version: 1, Type: "exec_start", Epoch: "epoch", RequestID: "req", OperationID: "op", Request: &operation.Request{ID: "op"}},
		{Version: 1, Type: "exec_result", Epoch: "epoch", RequestID: "req", OperationID: "op", Record: &journal.Record{ID: "op"}},
		{Version: 1, Type: "exec_error", Epoch: "epoch", RequestID: "req", OperationID: "op", Error: "device_busy"},
		{Version: 1, Type: "exec_cancel", Epoch: "epoch", RequestID: "req", OperationID: "op"},
	} {
		encoded, err := json.Marshal(f)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := Decode(encoded); err != nil {
			t.Fatal(err)
		}
	}
}

func TestAuthFrameBoundaries(t *testing.T) {
	valid := Frame{Version: 1, Type: "auth_refresh", Epoch: "epoch", RequestID: "refresh_1", AuthTicket: strings.Repeat("t", 43)}
	for _, mutate := range []func(*Frame){
		func(f *Frame) { f.RequestID = "" },
		func(f *Frame) { f.OperationID = "op" },
		func(f *Frame) { f.Request = &operation.Request{} },
		func(f *Frame) { f.Record = &journal.Record{} },
		func(f *Frame) { f.Error = "error" },
		func(f *Frame) { f.GrantID = "grant" },
		func(f *Frame) { f.Grant = &grant.Grant{} },
		func(f *Frame) { f.LeaseExpiresAt = 1 },
		func(f *Frame) { f.AuthTicket = "short" },
		func(f *Frame) { f.AuthTicket = strings.Repeat("!", 43) },
		func(f *Frame) { f.AuthExpiresAt = 1 },
		func(f *Frame) { f.Type = "auth_refreshed" },
		func(f *Frame) { f.Type = "auth_refreshed"; f.AuthTicket = "" },
		func(f *Frame) { f.Type = "welcome"; f.RequestID = "" },
		func(f *Frame) { f.Type = "exec_cancel"; f.OperationID = "op"; f.AuthTicket = ""; f.AuthExpiresAt = 1 },
	} {
		frame := valid
		mutate(&frame)
		if frame.Validate() == nil {
			t.Fatalf("accepted invalid auth frame: type=%s", frame.Type)
		}
	}
}

func TestMalformedFrames(t *testing.T) {
	for _, raw := range []string{
		"", strings.Repeat(" ", MaxFrameBytes+1), `{} {}`, `{"version":1,"type":"welcome","epoch":"e","extra":true}`,
		`{"version":1,"type":"welcome","epoch":"e","serverTime":-1}`,
		`{"version":1,"type":"exec_error","epoch":"e","requestId":"r","operationId":"op","error":"device_busy","serverTime":123}`,
		`{"version":1,"type":"welcome","epoch":"e","owner":{"deviceId":"device"}}`,
		`{"version":1,"type":"exec_error","epoch":"e","requestId":"r","operationId":"op","error":"device_busy","owner":{"deviceId":"device","teamId":"team","memberId":"member"}}`,
		`{"version":2,"type":"welcome","epoch":"e"}`,
		`{"version":1,"type":"welcome","epoch":"","requestId":"r"}`,
		`{"version":1,"type":"welcome","epoch":"e","requestId":"r"}`,
		`{"version":1,"type":"unknown","epoch":"e","requestId":"r","operationId":"op"}`,
		`{"version":1,"type":"exec_start","epoch":"e","requestId":"r","operationId":"op"}`,
		`{"version":1,"type":"exec_result","epoch":"e","requestId":"r","operationId":"op"}`,
		`{"version":1,"type":"exec_error","epoch":"e","requestId":"r","operationId":"op","error":"private path /secret"}`,
		`{"version":1,"type":"exec_start","epoch":"e"}`,
		`{"version":1,"type":"exec_query","epoch":"e","requestId":"r","operationId":"op"}`,
		`{"version":1,"type":"exec_cancel_query","epoch":"e","requestId":"r","operationId":"op"}`,
		`{"version":1,"type":"exec_cancel_query","epoch":"e","requestId":"r","operationId":"op","query":{"operationId":"other","grantId":"g","grantVersion":1}}`,
		`{"version":1,"type":"exec_cancel_query","epoch":"e","requestId":"r","operationId":"op","query":{"operationId":"op","grantId":"g","grantVersion":0}}`,
		`{"version":1,"type":"exec_query","epoch":"e","requestId":"r","operationId":"op","query":{"operationId":"other","grantId":"g","grantVersion":1}}`,
		`{"version":1,"type":"welcome","epoch":"e","query":{"operationId":"op","grantId":"g","grantVersion":1}}`,
		`{"version":1,"type":"exec_cancel","epoch":"e","requestId":"r","operationId":"op","error":"cancel"}`,
	} {
		if _, err := Decode([]byte(raw)); err == nil {
			t.Fatalf("accepted malformed frame: %.120s", raw)
		}
	}
}
