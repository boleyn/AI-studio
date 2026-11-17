package connector

import (
	"context"
	"encoding/json"
	"errors"
	"fastgpt.local/local-device/internal/transport"
	"io"
	"net/url"
	"os"
	"path/filepath"
	"strings"
)

type PlatformOptions struct {
	Directory     string
	Origin        string
	DefaultOrigin string
	Prompt        func(context.Context) (string, error)
}

type PlatformSettings struct {
	Origin  string   `json:"origin"`
	History []string `json:"history,omitempty"`
}

// ReadPlatformSettings loads bounded, validated preferences, including legacy origin-only files.
func ReadPlatformSettings(directory string) (PlatformSettings, error) {
	if !filepath.IsAbs(directory) {
		return PlatformSettings{}, errors.New("invalid_settings_directory")
	}
	path := filepath.Join(directory, "settings.json")
	info, err := os.Lstat(path)
	if err != nil {
		return PlatformSettings{}, err
	}
	if !info.Mode().IsRegular() || info.Size() > 65536 {
		return PlatformSettings{}, errors.New("invalid_local_settings")
	}
	file, err := os.Open(path)
	if err != nil {
		return PlatformSettings{}, err
	}
	defer file.Close()
	opened, err := file.Stat()
	if err != nil || !os.SameFile(info, opened) {
		return PlatformSettings{}, errors.New("local_settings_changed")
	}
	var settings PlatformSettings
	decoder := json.NewDecoder(io.LimitReader(file, 65537))
	decoder.DisallowUnknownFields()
	if decoder.Decode(&settings) != nil || decoder.Decode(new(any)) != io.EOF || len(settings.History) > 20 {
		return PlatformSettings{}, errors.New("invalid_local_settings")
	}
	settings.Origin, err = normalizePlatformOrigin(settings.Origin)
	if err != nil {
		return PlatformSettings{}, err
	}
	for i, value := range settings.History {
		settings.History[i], err = normalizePlatformOrigin(value)
		if err != nil {
			return PlatformSettings{}, err
		}
	}
	return settings, nil
}

func normalizePlatformOrigin(value string) (string, error) {
	if len(value) > 2048 {
		return "", errors.New("invalid_platform_origin")
	}
	u, err := url.Parse(strings.TrimSpace(value))
	if err != nil || !transport.SecureURL(u, "https", "http") || u.Host == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" || (u.Path != "" && u.Path != "/") {
		return "", errors.New("invalid_platform_origin")
	}
	u.Path = ""
	return u.String(), nil
}

// ResolvePlatform stores only a non-secret platform origin (HTTP or HTTPS). Explicit launch options
// do not overwrite saved settings. Missing settings prompt once; corrupt files
// fail visibly rather than silently replacing the user's platform choice.
func ResolvePlatform(ctx context.Context, input PlatformOptions) (string, error) {

	if input.Origin != "" {
		return normalizePlatformOrigin(input.Origin)
	}
	if !filepath.IsAbs(input.Directory) {
		return "", errors.New("invalid_settings_directory")
	}
	settings, err := ReadPlatformSettings(input.Directory)
	if err == nil {
		return settings.Origin, nil
	}
	if !errors.Is(err, os.ErrNotExist) {
		return "", err
	}
	if input.DefaultOrigin != "" {
		return normalizePlatformOrigin(input.DefaultOrigin)
	}
	if input.Prompt == nil {
		return "", errors.New("platform_address_required")
	}
	if err := ctx.Err(); err != nil {
		return "", err
	}
	value, err := input.Prompt(ctx)
	if err != nil {
		return "", err
	}
	if err := ctx.Err(); err != nil {
		return "", err
	}
	return writePlatformOrigin(input.Directory, value, false)
}

// SavePlatformOrigin atomically persists an explicitly selected platform without changing its binding.
func SavePlatformOrigin(directory, value string) (string, error) {
	return writePlatformOrigin(directory, value, true)
}

func writePlatformOrigin(directory, value string, replace bool) (string, error) {
	if !filepath.IsAbs(directory) {
		return "", errors.New("invalid_settings_directory")
	}
	path := filepath.Join(directory, "settings.json")
	origin, err := normalizePlatformOrigin(value)
	if err != nil {
		return "", err
	}
	if err = os.MkdirAll(directory, 0700); err != nil {
		return "", err
	}
	info, err := os.Lstat(directory)
	if err != nil || !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
		return "", errors.New("invalid_settings_directory")
	}
	settings := PlatformSettings{Origin: origin}
	if replace {
		previous, readErr := ReadPlatformSettings(directory)
		if readErr != nil && !errors.Is(readErr, os.ErrNotExist) {
			return "", readErr
		}
		settings.History = []string{origin}
		for _, value := range append([]string{previous.Origin}, previous.History...) {
			if value == "" {
				continue
			}
			exists := false
			for _, saved := range settings.History {
				if saved == value {
					exists = true
					break
				}
			}
			if !exists && len(settings.History) < 20 {
				settings.History = append(settings.History, value)
			}
		}
	}
	encoded, err := json.Marshal(settings)
	if err != nil {
		return "", err
	}
	// Publish atomically without replacing another process's concurrent choice.
	file, err := os.CreateTemp(directory, ".settings-")
	if err != nil {
		return "", err
	}
	defer os.Remove(file.Name())
	defer file.Close()
	if _, err = file.Write(encoded); err != nil {
		return "", err
	}
	if err = file.Sync(); err != nil {
		return "", err
	}
	if err = file.Close(); err != nil {
		return "", err
	}
	if replace {
		err = os.Rename(file.Name(), path)
	} else {
		err = os.Link(file.Name(), path)
	}
	if err != nil {
		return "", errors.New("settings_publish_failed")
	}
	return origin, nil
}
