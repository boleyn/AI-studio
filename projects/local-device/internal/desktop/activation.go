package desktop

// Management requests carry no authorization data. Buffer one request so a second
// Windows launch during startup is remembered without opening duplicate windows.
var managementRequests = make(chan struct{}, 1)

type managementSnapshot struct {
	Status   string       `json:"status"`
	Accounts []accountRow `json:"accounts"`
}

var managementSnapshotRequests = make(chan chan managementSnapshot)

// RequestManagement opens or activates the management window through the tray
// controller. It never approves a grant or starts another connector instance.
func RequestManagement() {
	select {
	case managementRequests <- struct{}{}:
	default:
	}
}
