package executor

import (
	"bytes"
	"context"
	"runtime"
	"sync"
	"testing"
	"time"
)

func TestOutputReplayAndOwnership(t *testing.T) {
	stream := &OutputStream{}
	data := []byte("你好")
	stream.append(false, data[:1], false)
	stream.append(false, data[1:], false)
	stream.append(true, []byte("error"), false)
	data[0] = 'x'
	stream.close()
	first := stream.Read(0, 1)
	if first.Gap || first.Done || first.Next != 1 || len(first.Events) != 1 {
		t.Fatalf("bad page: %+v", first)
	}
	remaining := stream.Read(first.Next, 64)
	if !remaining.Done || remaining.Next != 3 || remaining.Events[1].Stream != "stderr" {
		t.Fatalf("bad tail: %+v", remaining)
	}
	if string(append(first.Events[0].Data, remaining.Events[0].Data...)) != "你好" {
		t.Fatal("split UTF-8 was altered")
	}
	first.Events[0].Data[0] = 'z'
	if stream.Read(0, 1).Events[0].Data[0] == 'z' {
		t.Fatal("reader mutated replay")
	}
	stream.append(false, []byte("late"), false)
	if stream.Read(3, 0).Next != 3 || !stream.Read(3, 0).Done {
		t.Fatal("closed stream accepted output")
	}
	if page := stream.Read(100, 64); !page.Gap || page.Done || page.Next != 3 {
		t.Fatalf("future cursor accepted: %+v", page)
	}
}

func TestOutputReplayIsBoundedAndReportsGaps(t *testing.T) {
	for _, size := range []int{1, outputChunkBytes} {
		stream := &OutputStream{}
		for i := 0; i < outputEventLimit+10; i++ {
			stream.append(false, bytes.Repeat([]byte("x"), size), false)
		}
		if stream.count > outputEventLimit || stream.bytes > outputReplayBytes {
			t.Fatal("unbounded buffer")
		}
		page := stream.Read(0, 10000)
		if !page.Gap || len(page.Events) != min(64, outputReplayBytes/size) || page.Done {
			t.Fatalf("missing bounded gap: size=%d events=%d gap=%v done=%v", size, len(page.Events), page.Gap, page.Done)
		}
		stream.close()
		for !page.Done {
			page = stream.Read(page.Next, 64)
			if page.Gap {
				t.Fatal("stable replay lost another page")
			}
		}
		if page.Next != outputEventLimit+10 {
			t.Fatal("lost sequence")
		}
	}
	stream := &OutputStream{}
	buffer := &boundedOutput{remaining: 3, stream: stream}
	writer := outputWriter{buffer: buffer}
	if n, err := writer.Write([]byte("abcdef")); n != 6 || err != nil {
		t.Fatal("pipe was not drained")
	}
	page := stream.Read(0, 1)
	if !page.Truncated || string(page.Events[0].Data) != "abc" {
		t.Fatal("truncation not visible")
	}
}

func TestOutputConcurrentWriters(t *testing.T) {
	stream := &OutputStream{}
	buffer := &boundedOutput{remaining: 128 * 1024, stream: stream}
	var writers sync.WaitGroup
	for _, stderr := range []bool{false, true} {
		writers.Add(1)
		go func(stderr bool) {
			defer writers.Done()
			for i := 0; i < 100; i++ {
				outputWriter{buffer: buffer, stderr: stderr}.Write([]byte("x"))
				stream.Read(0, 64)
			}
		}(stderr)
	}
	writers.Wait()
	stream.close()
	var after uint64
	for {
		page := stream.Read(after, 64)
		if page.Gap {
			t.Fatal("unexpected gap")
		}
		for _, event := range page.Events {
			after++
			if event.Sequence != after {
				t.Fatal("sequence mismatch")
			}
		}
		if page.Done {
			break
		}
	}
	if after != 200 {
		t.Fatal("missing events")
	}
}

func TestNativeOutputAvailableBeforeProcessExit(t *testing.T) {
	kind, command := "bash", "printf early; sleep 2; printf late"
	if runtime.GOOS == "windows" {
		kind, command = "powershell", "[Console]::Write('early'); Start-Sleep -Seconds 2; [Console]::Write('late')"
	}
	shell, err := ResolveShell(kind)
	if err != nil {
		t.Fatal(err)
	}
	stream := &OutputStream{}
	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancel()
	done := make(chan Result, 1)
	go func() {
		result, err := Run(ctx, shell, Request{Command: command, Workdir: t.TempDir(), Timeout: 5 * time.Second, Output: stream})
		if err != nil {
			t.Error(err)
		}
		done <- result
	}()
	limit := time.Now().Add(1500 * time.Millisecond)
	for {
		page := stream.Read(0, 64)
		if len(page.Events) > 0 {
			if page.Done || string(page.Events[0].Data) != "early" {
				t.Fatalf("not live output: %+v", page)
			}
			break
		}
		if time.Now().After(limit) {
			t.Fatal("no live output")
		}
		time.Sleep(5 * time.Millisecond)
	}
	result := <-done
	if result.Status != "completed" || result.Stdout != "earlylate" || !stream.Read(0, 64).Done {
		t.Fatalf("final output mismatch: %+v", result)
	}
}
