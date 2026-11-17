package connector

import (
	"context"
	"encoding/json"
	"strconv"
	"time"

	"fastgpt.local/local-device/internal/protocol"
	"fastgpt.local/local-device/internal/remoteclock"
	"github.com/coder/websocket"
)

// refreshAuthentication renews credentials in-band without replacing the socket or replaying
// commands. Any rejection or missing acknowledgement ends this session; Run may reauthenticate,
// but it must never treat an interrupted command as safe to repeat.
func refreshAuthentication(ctx context.Context, socket *websocket.Conn, welcome protocol.Frame, authenticate func(context.Context) (ConnectionTicket, error), replies <-chan protocol.Frame, clock *remoteclock.Clock) {
	expires := time.UnixMilli(welcome.AuthExpiresAt)
	for sequence := 1; ; sequence++ {
		remaining := expires.Sub(clock.Now())
		if remaining <= 0 {
			return
		}
		timer := time.NewTimer(remaining / 2)
		select {
		case <-ctx.Done():
			timer.Stop()
			return
		case <-timer.C:
		}
		// Both acquiring the new ticket and its acknowledgement must finish before old expiry.
		refreshCtx, cancel := context.WithTimeout(ctx, expires.Sub(clock.Now()))
		ticket, err := authenticate(refreshCtx)
		if err != nil || ticket.ExpiresAt <= expires.UnixMilli() || !validRemoteExpiry(ticket.ExpiresAt, clock.Now().UnixMilli(), 5*time.Minute) {
			cancel()
			return
		}
		request := protocol.Frame{Version: protocol.Version, Type: "auth_refresh", Epoch: welcome.Epoch, RequestID: "refresh_" + strconv.Itoa(sequence), AuthTicket: ticket.Ticket}
		if request.Validate() != nil {
			cancel()
			return
		}
		data, _ := json.Marshal(request)
		if socket.Write(refreshCtx, websocket.MessageText, data) != nil {
			cancel()
			return
		}
		select {
		case <-refreshCtx.Done():
			cancel()
			return
		case reply := <-replies:
			cancel()
			if reply.RequestID != request.RequestID || reply.AuthExpiresAt != ticket.ExpiresAt || reply.AuthExpiresAt <= clock.Now().UnixMilli() {
				return
			}
			expires = time.UnixMilli(reply.AuthExpiresAt)
		}
	}
}
