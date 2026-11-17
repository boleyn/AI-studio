package protocol

import (
	"encoding/json"
	"testing"

	"fastgpt.local/local-device/internal/executor"
	"fastgpt.local/local-device/internal/operation"
)

func TestOutputFrames(t *testing.T) {
	query := func() Frame {
		return Frame{Version: Version, Epoch: "epoch", RequestID: "request", OperationID: "op", Type: "exec_output_query", OutputQuery: &operation.OutputQuery{Query: operation.Query{ID: "op", GrantID: "grant", GrantVersion: 1}, Limit: 64}}
	}
	page := func() Frame {
		return Frame{Version: Version, Epoch: "epoch", RequestID: "request", OperationID: "op", Type: "exec_output", Output: &executor.OutputPage{Events: []executor.OutputEvent{{Sequence: 1, Stream: "stdout", Data: []byte{0xe4}}}, Next: 1}}
	}
	for _, frame := range []Frame{query(), page()} {
		encoded, err := json.Marshal(frame)
		if err != nil {
			t.Fatal(err)
		}
		decoded, err := Decode(encoded)
		if err != nil || decoded.Type != frame.Type {
			t.Fatalf("valid frame: %v", err)
		}
		if frame.Output != nil && decoded.Output.Events[0].Data[0] != 0xe4 {
			t.Fatal("split UTF-8 byte corrupted")
		}
	}
	for _, mutate := range []func(*Frame){
		func(f *Frame) { f.OutputQuery = nil },
		func(f *Frame) { f.OutputQuery.ID = "other" },
		func(f *Frame) { f.OutputQuery.GrantID = "" },
		func(f *Frame) { f.OutputQuery.GrantVersion = 0 },
		func(f *Frame) { f.OutputQuery.Limit = 0 },
		func(f *Frame) { f.OutputQuery.Limit = 65 },
		func(f *Frame) { f.OutputQuery.After = 9007199254740992 },
		func(f *Frame) { f.Request = &operation.Request{} },
		func(f *Frame) { f.Type = "exec_cancel" },
	} {
		frame := query()
		mutate(&frame)
		if frame.Validate() == nil {
			t.Fatal("invalid output query accepted")
		}
	}
	for _, mutate := range []func(*Frame){
		func(f *Frame) { f.Output = nil },
		func(f *Frame) { f.Output.Next = 9007199254740992 },
		func(f *Frame) { f.Output.Next = 2 },
		func(f *Frame) { f.Output.Events[0].Sequence = 0 },
		func(f *Frame) { f.Output.Events[0].Stream = "unknown" },
		func(f *Frame) { f.Output.Events[0].Data = nil },
		func(f *Frame) { f.Output.Events[0].Data = make([]byte, 4097) },
		func(f *Frame) { f.Output.Events = append(f.Output.Events, f.Output.Events[0]) },
		func(f *Frame) { f.Output.Events = make([]executor.OutputEvent, 65) },
		func(f *Frame) { f.Type = "exec_error"; f.Error = "error" },
	} {
		frame := page()
		mutate(&frame)
		if frame.Validate() == nil {
			t.Fatal("invalid output response accepted")
		}
	}
}
