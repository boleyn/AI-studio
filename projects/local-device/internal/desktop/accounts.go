package desktop

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"os"
	"path/filepath"
	"sort"

	"fastgpt.local/local-device/internal/connector"
	"fastgpt.local/local-device/internal/grant"
)

type accountRow struct {
	ID                 string       `json:"id"`
	Name               string       `json:"name"`
	Team               string       `json:"team"`
	Avatar             string       `json:"avatar,omitempty"`
	Platform           string       `json:"platform"`
	State              string       `json:"state"`
	Workdir            string       `json:"workdir"`
	Sessions           []sessionRow `json:"sessions"`
	HistoryUnavailable bool         `json:"historyUnavailable"`
}

type sessionRow struct {
	ID      string `json:"id"`
	Title   string `json:"title"`
	App     string `json:"app"`
	Workdir string `json:"workdir"`
	Status  string `json:"status"`
}

func accountID(local *connector.LocalSession) string { return local.Origin + "#" + local.DeviceID }

// accountDetails uses legacy presentation names only for display and local confirmation.
func accountDetails(local *connector.LocalSession) grant.AccountAccess {
	access := local.Grants.AccountAccess()
	if access.Name == "" {
		for _, item := range local.Grants.Snapshot() {
			if item.Display != nil && item.Display.MemberName != "" {
				access.Name, access.Team = item.Display.MemberName, item.Display.TeamName
				break
			}
		}
	}
	return access
}

func accountRows(ctx context.Context, locals []*connector.LocalSession) []accountRow {
	rows := make([]accountRow, 0, len(locals))
	for _, local := range locals {
		access := accountDetails(local)
		if access.Removed {
			continue
		}
		state := "legacy"
		switch {
		case access.Paused:
			state = "paused"
		case access.Workdir != "":
			state = "active"
		}
		name := access.Name
		if name == "" {
			name = "已绑定用户"
		}
		history, err := local.Grants.History(ctx)
		sessions := make([]sessionRow, 0, len(history))
		for _, item := range history {
			// 仅过滤界面列表，保留撤销记录和会话拦截状态。
			if item.Revoked || access.BlocksSession(item) {
				continue
			}
			row := sessionRow{ID: item.ID, Workdir: item.Workdir, Title: "未命名会话", Status: "已授权"}
			if item.Display != nil {
				row.App = item.Display.AppName
				if item.Display.ChatTitle != "" {
					row.Title = item.Display.ChatTitle
				}
			}
			switch {
			case local.Grants.Expired(item):
				row.Status = "已过期"
			case access.Paused:
				row.Status = "已暂停"
			}
			sessions = append(sessions, row)
		}
		rows = append(rows, accountRow{ID: accountID(local), Name: name, Team: access.Team, Platform: local.Origin, State: state, Avatar: access.Avatar, Workdir: access.Workdir, Sessions: sessions, HistoryUnavailable: err != nil})
	}
	sort.Slice(rows, func(i, j int) bool {
		if rows[i].Name == rows[j].Name {
			return rows[i].ID < rows[j].ID
		}
		return rows[i].Name < rows[j].Name
	})
	return rows
}

// confirmAccountAccess names the recipient and explains persistent command access before storing it.
func confirmAccountAccess(ctx context.Context, origin, name, team string) (grant.AccountAccess, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return grant.AccountAccess{}, err
	}
	directory, err := dialog(ctx, "accountApprove", "用户："+name+"\n团队："+team+"\n平台："+origin+"\n\n该用户可在新会话执行本机命令，无需逐次确认。", home)
	return grant.AccountAccess{Name: name, Team: team, Workdir: directory}, err
}

func changeAccountAccess(ctx context.Context, local *connector.LocalSession, action string) error {
	access := accountDetails(local)
	switch action {
	case "enable":
		if access.Name == "" {
			return errors.New("请通过该账号生成的链接重新添加授权")
		}
		var err error
		access, err = confirmAccountAccess(ctx, local.Origin, access.Name, access.Team)
		if err != nil {
			return err
		}
	case "pause":
		access.Paused = true
	case "resume":
		access.Paused = false
	case "remove":
		access.Removed = true
	default:
		return errors.New("invalid_account_action")
	}
	if err := local.Grants.SetAccountAccess(ctx, access); err != nil {
		return err
	}
	if access.Paused || access.Removed {
		local.Service.StopActive()
	}
	if access.Removed && local.Disconnect != nil {
		local.Disconnect()
	}
	return nil
}

// Separate journals prevent grant and operation IDs from different platforms colliding.
func platformDirectory(root, origin string) string {
	sum := sha256.Sum256([]byte(origin))
	return filepath.Join(root, "platforms", hex.EncodeToString(sum[:]))
}

func savedPlatforms(root string) []string {
	entries, _ := os.ReadDir(filepath.Join(root, "platforms"))
	var origins []string
	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		directory := filepath.Join(root, "platforms", entry.Name())
		if settings, err := connector.ReadPlatformSettings(directory); err == nil && directory == platformDirectory(root, settings.Origin) {
			origins = append(origins, settings.Origin)
		}
	}
	return origins
}
