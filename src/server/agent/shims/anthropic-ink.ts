export type RenderOptions = Record<string, unknown>;
export type Instance = unknown;
export type Root = {
  render?: (...args: unknown[]) => void;
  unmount?: () => void;
  waitUntilExit?: () => Promise<void>;
};

export type DOMElement = unknown;
export type TextNode = unknown;
export type ElementNames = string;
export type DOMNodeAttribute = Record<string, unknown>;
export type Styles = Record<string, unknown>;
export type TextStyles = Record<string, unknown>;
export type Color = string;
export type RGBColor = string;
export type HexColor = string;
export type Ansi256Color = number;
export type AnsiColor = string;
export type Key = string;
export type FlickerReason = string;
export type FrameEvent = unknown;
export type MatchPosition = unknown;
export type SelectionState = unknown;
export type FocusMove = unknown;
export type Progress = unknown;
export type BorderTextOptions = Record<string, unknown>;
export type AppProps = Record<string, unknown>;
export type StdinProps = Record<string, unknown>;
export type TerminalSize = { columns?: number; rows?: number };
export type BoxProps = Record<string, unknown>;
export type TextProps = Record<string, unknown>;
export type LinkProps = Record<string, unknown>;
export type NewlineProps = Record<string, unknown>;
export type ButtonState = unknown;
export type ButtonProps = Record<string, unknown>;
export type TabStatusKind = string;
export type TerminalNotification = unknown;
export type ScrollBoxHandle = {
  scrollBy?: (...args: unknown[]) => void;
};
export type ColorType = string;
export type KeybindingSetupProps = Record<string, unknown>;
export type ParsedBinding = unknown;
export type ParsedKeystroke = unknown;
export type KeybindingContextName = string;
export type KeybindingBlock = unknown;
export type Chord = unknown;
export type KeybindingAction = unknown;
export type KeybindingWarningType = string;
export type KeybindingWarning = unknown;
export type KeybindingsLoadResult = unknown;
export type ResolveResult = unknown;
export type ChordResolveResult = unknown;
export type ClickEvent = unknown;
export type Event = unknown;
export type InputEvent = unknown;
export type TerminalFocusEventType = string;
export type TerminalFocusEvent = unknown;
export type KeyboardEvent = unknown;
export type FocusEvent = unknown;
export type ThemeSetting = { value?: string };

import type { ReactNode } from "react";

type AnyProps = Record<string, unknown> & { children?: ReactNode };

const noop = () => undefined;
const noopAsync = async () => undefined;
const nullComp = (_props?: AnyProps) => null;

export const wrappedRender = () => ({
  unmount: noop,
  waitUntilExit: noopAsync,
});
export const renderSync = wrappedRender;
export const createRoot = () => ({
  unmount: noop,
  waitUntilExit: noopAsync,
});
export class Ink {}

export const useKeybinding = noop;
export const useKeybindings = noop;
export const KeybindingProvider = nullComp;
export const useKeybindingContext = () => ({});
export const useOptionalKeybindingContext = () => null;
export const useRegisterKeybindingContext = noop;
export const resolveKey = () => null;
export const resolveKeyWithChordState = () => null;
export const getBindingDisplayText = () => "";
export const keystrokesEqual = () => false;
export const parseKeystroke = () => null;
export const parseChord = () => null;
export const keystrokeToString = () => "";
export const chordToString = () => "";
export const keystrokeToDisplayString = () => "";
export const chordToDisplayString = () => "";
export const parseBindings = () => ({});
export const getKeyName = () => "";
export const matchesKeystroke = () => false;
export const matchesBinding = () => false;
export const KeybindingSetup = nullComp;

export class EventEmitter {}
export class FocusManager {}
export class ClickEventClass {}
export class EventClass {}
export class InputEventClass {}
export class TerminalFocusEventClass {}
export class KeyboardEventClass {}
export class FocusEventClass {}
export const ClickEvent = ClickEventClass;
export const Event = EventClass;
export const InputEvent = InputEventClass;
export const TerminalFocusEvent = TerminalFocusEventClass;
export const KeyboardEvent = KeyboardEventClass;
export const FocusEvent = FocusEventClass;

export const Ansi = nullComp;
export const stringWidth = (value: string) => Array.from(String(value || "")).length;
export const wrapText = (value: string) => value;
export const measureElement = () => ({ width: 0, height: 0 });
export const supportsTabStatus = () => false;
export const setClipboard = noopAsync;
export const getClipboardPath = () => "";
export const CLEAR_ITERM2_PROGRESS = "";
export const CLEAR_TAB_STATUS = "";
export const CLEAR_TERMINAL_TITLE = "";
export const wrapForMultiplexer = (value: string) => value;
export const DISABLE_KITTY_KEYBOARD = "";
export const DISABLE_MODIFY_OTHER_KEYS = "";
export const SHOW_CURSOR = "\u001b[?25h";
export const HIDE_CURSOR = "\u001b[?25l";
export const ENTER_ALT_SCREEN = "";
export const EXIT_ALT_SCREEN = "";
export const ENABLE_MOUSE_TRACKING = "";
export const DISABLE_MOUSE_TRACKING = "";
export const DBP = "";
export const DFE = "";
export const instances: unknown[] = [];
export const renderBorder = () => "";
export const isSynchronizedOutputSupported = () => false;
export const isXtermJs = () => false;
export const hasCursorUpViewportYankBug = () => false;
export const writeDiffToTerminal = noop;
export const colorize = (value: string) => value;
export const applyColor = (value: string) => value;
export const applyTextStyles = (value: string) => value;
export const wrapAnsi = (value: string) => value;
export const styles = {};
export const clamp = (value: number, min = 0, max = 0) => Math.max(min, Math.min(max, value));
export const getTerminalFocusState = () => true;
export const getTerminalFocused = () => true;
export const subscribeTerminalFocus = () => noop;
export const supportsHyperlinks = () => false;

export const BaseBox = nullComp;
export const BaseText = nullComp;
export const Button = nullComp;
export const Link = nullComp;
export const Newline = nullComp;
export const Spacer = nullComp;
export const NoSelect = nullComp;
export const RawAnsi = nullComp;
export const ScrollBox = nullComp;
export const AlternateScreen = nullComp;
export const TerminalSizeContext = {};

export const useApp = () => ({ exit: noop });
export const useInput = noop;
export const useAnimationFrame = noop;
export const useAnimationTimer = noop;
export const useInterval = noop;
export const useSelection = () => ({});
export const useHasSelection = () => false;
export const useStdin = () => ({ isRawModeSupported: false, setRawMode: noop });
export const useTerminalSize = () => ({ columns: 0, rows: 0 });
export const useTimeout = noop;
export const useMinDisplayTime = <T>(value: T) => value;
export const DOUBLE_PRESS_TIMEOUT_MS = 250;
export const useDoublePress = () => false;
export const useTabStatus = noop;
export const useTerminalFocus = () => true;
export const useTerminalTitle = noop;
export const useTerminalViewport = () => ({ width: 0, height: 0 });
export const useSearchHighlight = noop;
export const useDeclaredCursor = noop;
export const TerminalWriteProvider = nullComp;
export const useTerminalNotification = () => noop;

export const ThemeProvider = nullComp;
export const usePreviewTheme = () => ({ name: "default" });
export const useTheme = () => ({ colors: {} as Record<string, string> });
export const useThemeSetting = (): ThemeSetting => ({ value: "default" });
export const Box = nullComp;
export const Text = nullComp;
export const TextHoverColorContext = {} as unknown;
export const color = {
  red: (s: string) => s,
  yellow: (s: string) => s,
  green: (s: string) => s,
  blue: (s: string) => s,
  magenta: (s: string) => s,
  cyan: (s: string) => s,
  gray: (s: string) => s,
};
export const SearchBox = nullComp;
export const Dialog = nullComp;
export const Divider = nullComp;
export const FuzzyPicker = nullComp;
export const ListItem = nullComp;
export const LoadingState = nullComp;
export const Pane = nullComp;
export const ProgressBar = nullComp;
export const Ratchet = nullComp;
export const StatusIcon = nullComp;
export const Tabs = nullComp;
export const Tab = nullComp;
export const useTabsWidth = () => 0;
export const useTabHeaderFocus = () => false;
export const Byline = nullComp;
export const KeyboardShortcutHint = nullComp;
