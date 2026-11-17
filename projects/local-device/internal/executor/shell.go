package executor

import (
	"encoding/base64"
	"encoding/binary"
	"errors"
	"os/exec"
	"path/filepath"
	"strings"
	"unicode/utf16"
)

// Shell is chosen locally, never from an untrusted command request.
type Shell struct {
	Path string `json:"path"`
	Kind string `json:"kind"`
}

// ResolveShell does not search the current directory or silently switch after failure.
func ResolveShell(kind string) (Shell, error) {
	names := map[string][]string{
		"bash": {"bash"}, "sh": {"sh"},
		"powershell": {"pwsh.exe", "powershell.exe"}, "cmd": {"cmd.exe"},
	}
	candidates, ok := names[kind]
	if !ok {
		return Shell{}, errors.New("unsupported_shell")
	}
	for _, name := range candidates {
		path, err := exec.LookPath(name)
		if err == nil && filepath.IsAbs(path) {
			return Shell{Path: path, Kind: kind}, nil
		}
	}
	return Shell{}, errors.New("shell_not_found")
}

// commandArgs keeps script text in one argument; PowerShell encoding avoids nested quote loss.
// It does not change execution policy. Native exit codes and terminating errors reach the caller.
func commandArgs(shell Shell, command string) ([]string, error) {
	if strings.TrimSpace(command) == "" || len(command) > 65536 || strings.ContainsRune(command, 0) {
		return nil, errors.New("invalid_command")
	}
	switch shell.Kind {
	case "bash":
		return []string{"--noprofile", "--norc", "-c", command}, nil
	case "sh":
		return []string{"-c", command}, nil
	case "cmd":
		return []string{"/D", "/S", "/C", command}, nil
	case "powershell":
		script := "$ErrorActionPreference='Stop'; $ProgressPreference='SilentlyContinue'; " +
			"[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new($false); " +
			"$OutputEncoding=[Console]::OutputEncoding; $global:LASTEXITCODE=0; try { & {\n" +
			command + "\n}; if (-not $?) { if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }; exit 1 }; exit $LASTEXITCODE } catch { [Console]::Error.WriteLine($_.ToString()); exit 1 }"
		units := utf16.Encode([]rune(script))
		raw := make([]byte, len(units)*2)
		for i, unit := range units {
			binary.LittleEndian.PutUint16(raw[i*2:], unit)
		}
		return []string{"-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand", base64.StdEncoding.EncodeToString(raw)}, nil
	default:
		return nil, errors.New("unsupported_shell")
	}
}
