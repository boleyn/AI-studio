package connector

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func TestPlatformSettingsPersistWithoutSecrets(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "settings")
	input := PlatformOptions{Directory: dir, Prompt: func(context.Context) (string, error) { return " https://platform.example/\n", nil }}
	origin, err := ResolvePlatform(context.Background(), input)
	if err != nil || origin != "https://platform.example" {
		t.Fatalf("%s %v", origin, err)
	}
	input.Prompt = func(context.Context) (string, error) { t.Fatal("prompted again"); return "", nil }
	if saved, err := ResolvePlatform(context.Background(), input); err != nil || saved != origin {
		t.Fatalf("lost settings: %s %v", saved, err)
	}
	input.Origin = "https://override.example"
	if saved, err := ResolvePlatform(context.Background(), input); err != nil || saved != input.Origin {
		t.Fatalf("override failed: %s %v", saved, err)
	}
	raw, err := os.ReadFile(filepath.Join(dir, "settings.json"))
	if err != nil || string(raw) != `{"origin":"https://platform.example"}` {
		t.Fatalf("unexpected preferences: %s %v", raw, err)
	}
	if runtime.GOOS != "windows" {
		info, err := os.Stat(filepath.Join(dir, "settings.json"))
		if err != nil || info.Mode().Perm()&0077 != 0 {
			t.Fatal("preferences not private")
		}
	}
}

func TestPlatformSettingsRejectUnsafeOrCancelledSetup(t *testing.T) {
	for _, value := range []string{"ftp://platform.example", "https://user:password@platform.example", "https://platform.example/path", "https://platform.example?token=secret", "https://platform.example/#fragment", "https://", strings.Repeat("a", 2049)} {
		dir := filepath.Join(t.TempDir(), "settings")
		if _, err := ResolvePlatform(context.Background(), PlatformOptions{Directory: dir, Prompt: func(context.Context) (string, error) { return value, nil }}); err == nil {
			t.Fatalf("accepted unsafe origin: %.80s", value)
		}
		if _, err := os.Stat(dir); !errors.Is(err, os.ErrNotExist) {
			t.Fatal("invalid input created settings")
		}
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := ResolvePlatform(ctx, PlatformOptions{Directory: t.TempDir(), Prompt: func(context.Context) (string, error) { t.Fatal("cancelled setup prompted"); return "", nil }}); !errors.Is(err, context.Canceled) {
		t.Fatal(err)
	}
	if _, err := ResolvePlatform(context.Background(), PlatformOptions{Directory: t.TempDir()}); err == nil {
		t.Fatal("unconfigured headless setup succeeded")
	}
	if _, err := ResolvePlatform(context.Background(), PlatformOptions{Directory: "relative"}); err == nil {
		t.Fatal("relative state directory accepted")
	}
	if _, err := ResolvePlatform(context.Background(), PlatformOptions{Directory: t.TempDir(), Prompt: func(context.Context) (string, error) { return "", context.Canceled }}); !errors.Is(err, context.Canceled) {
		t.Fatal(err)
	}
}

func TestCorruptSettingsNeverOverwritten(t *testing.T) {
	for _, raw := range []string{`{`, `{"origin":"https://platform.example","token":"secret"}`, `{"origin":"https://platform.example"} {}`, strings.Repeat("x", 4097)} {
		dir := t.TempDir()
		path := filepath.Join(dir, "settings.json")
		if err := os.WriteFile(path, []byte(raw), 0600); err != nil {
			t.Fatal(err)
		}
		if _, err := ResolvePlatform(context.Background(), PlatformOptions{Directory: dir, Prompt: func(context.Context) (string, error) { t.Fatal("corrupt settings silently replaced"); return "", nil }}); err == nil {
			t.Fatal("corrupt settings accepted")
		}
		actual, err := os.ReadFile(path)
		if err != nil || string(actual) != raw {
			t.Fatal("corrupt settings changed")
		}
	}
}

func TestConcurrentSetupDoesNotOverwriteAnotherChoice(t *testing.T) {
	dir := t.TempDir()
	entered, release := make(chan struct{}, 2), make(chan struct{})
	results := make(chan error, 2)
	for _, origin := range []string{"https://one.example", "https://two.example"} {
		go func() {
			_, err := ResolvePlatform(context.Background(), PlatformOptions{Directory: dir, Prompt: func(context.Context) (string, error) { entered <- struct{}{}; <-release; return origin, nil }})
			results <- err
		}()
	}
	<-entered
	<-entered
	close(release)
	first, second := <-results, <-results
	if (first == nil) == (second == nil) {
		t.Fatalf("expected exactly one atomic publisher: %v %v", first, second)
	}
	origin, err := ResolvePlatform(context.Background(), PlatformOptions{Directory: dir})
	if err != nil || (origin != "https://one.example" && origin != "https://two.example") {
		t.Fatalf("invalid winning origin: %s %v", origin, err)
	}
}

func TestSwitchPlatformPersistsLoopbackOrigin(t *testing.T) {
	dir := t.TempDir()
	options := PlatformOptions{Directory: dir, DefaultOrigin: "https://packaged.example"}
	ctx := context.Background()
	if got, err := ResolvePlatform(ctx, options); err != nil || got != options.DefaultOrigin {
		t.Fatalf("packaged default: %s %v", got, err)
	}
	if _, err := SavePlatformOrigin(dir, "https://old.example"); err != nil {
		t.Fatal(err)
	}
	if _, err := SavePlatformOrigin(dir, "http://localhost:3000/"); err != nil {
		t.Fatal(err)
	}
	if _, err := SavePlatformOrigin(dir, "ftp://remote.example"); err == nil {
		t.Fatal("accepted unsupported protocol")
	}
	if got, err := ResolvePlatform(ctx, options); err != nil || got != "http://localhost:3000" {
		t.Fatalf("saved override: %s %v", got, err)
	}
}

func TestSavedPlatformHistorySurvivesRestart(t *testing.T) {
	dir := t.TempDir()
	for _, origin := range []string{"https://chat.asiainfo.tech", "http://localhost:3000", "https://chat.asiainfo.tech"} {
		if _, err := SavePlatformOrigin(dir, origin); err != nil {
			t.Fatal(err)
		}
	}
	settings, err := ReadPlatformSettings(dir)
	if err != nil || settings.Origin != "https://chat.asiainfo.tech" || len(settings.History) != 2 {
		t.Fatalf("history lost: %#v %v", settings, err)
	}
	if got, err := ResolvePlatform(context.Background(), PlatformOptions{Directory: dir, DefaultOrigin: "https://other.example"}); err != nil || got != settings.Origin {
		t.Fatalf("restart ignored saved origin: %s %v", got, err)
	}
}
