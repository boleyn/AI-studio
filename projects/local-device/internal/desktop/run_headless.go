//go:build headless

package desktop

import (
	"context"
	"fastgpt.local/local-device/internal/connector"
)

// Run without a tray is only for developer/headless builds. Local confirmation is
// still mandatory: this flag never enables unattended automatic authorization.
func Run(ctx context.Context, input connector.StartOptions) error {
	return StartConfigured(ctx, input)
}
