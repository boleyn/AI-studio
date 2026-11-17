package executor

import "sync"

const outputChunkBytes = 4096
const outputEventLimit = 256
const outputReplayBytes = 128 * 1024

// OutputEvent keeps raw bytes so UTF-8 split across pipe writes is not corrupted.
// JSON transports encode Data as base64; the receiving stream decoder owns text conversion.
type OutputEvent struct {
	Sequence uint64 `json:"seq"`
	Stream   string `json:"stream"`
	Data     []byte `json:"data"`
}

type OutputPage struct {
	Events    []OutputEvent `json:"events"`
	Next      uint64        `json:"next"`
	Gap       bool          `json:"gap"`
	Done      bool          `json:"done"`
	Truncated bool          `json:"truncated"`
}

// OutputStream is a bounded replay ring. Producers never wait for a network consumer;
// slow readers receive an explicit gap and can retrieve the bounded final operation result.
// One stream belongs to one execution and must not be reused for another operation.
type OutputStream struct {
	mu                 sync.Mutex
	events             [outputEventLimit]OutputEvent
	head, count, bytes int
	sequence           uint64
	done               bool
	truncated          bool
}

func (s *OutputStream) append(stderr bool, data []byte, truncated bool) {
	if s == nil {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.done {
		return
	}
	s.truncated = s.truncated || truncated
	stream := "stdout"
	if stderr {
		stream = "stderr"
	}
	for len(data) > 0 {
		n := min(len(data), outputChunkBytes)
		for s.count > 0 && (s.count == outputEventLimit || s.bytes+n > outputReplayBytes) {
			s.bytes -= len(s.events[s.head].Data)
			s.events[s.head] = OutputEvent{}
			s.head = (s.head + 1) % outputEventLimit
			s.count--
		}
		s.sequence++
		event := OutputEvent{Sequence: s.sequence, Stream: stream, Data: append([]byte(nil), data[:n]...)}
		s.events[(s.head+s.count)%outputEventLimit] = event
		s.count++
		s.bytes += n
		data = data[n:]
	}
}

func (s *OutputStream) close() {
	if s == nil {
		return
	}
	s.mu.Lock()
	s.done = true
	s.mu.Unlock()
}

// Read returns an immutable page after the last acknowledged sequence. Limits are clamped
// to a small bounded page. Done means the producer ended AND this page reaches its tail.
// A cursor ahead of the tail is also a gap, never evidence that output is complete.
func (s *OutputStream) Read(after uint64, limit int) OutputPage {
	s.mu.Lock()
	defer s.mu.Unlock()
	limit = max(1, min(limit, 64))
	page := OutputPage{Events: make([]OutputEvent, 0, limit), Next: after, Truncated: s.truncated}
	if after > s.sequence {
		page.Gap = true
		page.Next = s.sequence
		return page
	}
	if s.count > 0 && after < s.events[s.head].Sequence-1 {
		page.Gap = true
		page.Next = s.events[s.head].Sequence - 1
	}
	for i := 0; i < s.count && len(page.Events) < limit; i++ {
		event := s.events[(s.head+i)%outputEventLimit]
		if event.Sequence <= after {
			continue
		}
		event.Data = append([]byte(nil), event.Data...)
		page.Events = append(page.Events, event)
		page.Next = event.Sequence
	}
	page.Done = s.done && page.Next == s.sequence
	return page
}
