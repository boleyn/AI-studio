import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { Box, Flex, IconButton, Text, type BoxProps } from "@chakra-ui/react";
import { X } from "lucide-react";

export type AppDialogSize = "sm" | "md" | "lg" | "xl";

const SIZE_MAX_WIDTH: Record<AppDialogSize, string> = {
  sm: "400px",
  md: "480px",
  lg: "640px",
  xl: "900px",
};

let supportsDisplayTransitionCache: boolean | undefined;

function canTransitionDisplay(): boolean {
  if (supportsDisplayTransitionCache !== undefined) return supportsDisplayTransitionCache;
  if (typeof window === "undefined" || !window.CSS?.supports?.("transition-behavior", "allow-discrete") || !document.body) {
    return false;
  }
  const probe = document.createElement("div");
  probe.style.cssText = "transition: display 1s allow-discrete !important; display: block;";
  document.body.appendChild(probe);
  getComputedStyle(probe).display;
  probe.style.display = "none";
  supportsDisplayTransitionCache = getComputedStyle(probe).display === "block";
  probe.remove();
  return supportsDisplayTransitionCache;
}

function supportsTopLayerExit(): boolean {
  return typeof window !== "undefined" && Boolean(window.CSS?.supports?.("overlay", "auto")) && canTransitionDisplay();
}

export type AppDialogProps = {
  isOpen: boolean;
  onClose: () => void;
  title?: ReactNode;
  subtitle?: ReactNode;
  ariaLabel?: string;
  size?: AppDialogSize | string;
  maxW?: string;
  initialFocusRef?: RefObject<HTMLElement>;
  onSubmit?: (e: FormEvent) => void;
  footer?: ReactNode;
  cornerRadius?: string;
  bodyPadding?: number | string;
  children: ReactNode;
};

/**
 * 全站统一原生 <dialog> 弹窗容器（遵循 modern-web-guidance: dialog / animate-to-from-top-layer / prevent-page-scroll-under-modal-dialog）。
 * 使用浏览器原生 top-layer、::backdrop、overscroll-behavior: contain 与 @starting-style 入场/退场动画。
 */
export function AppDialog({
  isOpen,
  onClose,
  title,
  subtitle,
  ariaLabel = "对话框",
  size = "md",
  maxW,
  initialFocusRef,
  onSubmit,
  footer,
  cornerRadius,
  bodyPadding,
  children,
}: AppDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [rendered, setRendered] = useState(isOpen);
  const closingRef = useRef(false);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const resolvedMaxW =
    maxW || SIZE_MAX_WIDTH[(size as AppDialogSize) in SIZE_MAX_WIDTH ? (size as AppDialogSize) : "md"];

  const performAnimatedClose = useCallback(async (dialog: HTMLDialogElement) => {
    if (!dialog.open || closingRef.current) return;
    closingRef.current = true;
    if (!supportsTopLayerExit()) {
      dialog.setAttribute("data-closing", "");
      const animations = typeof dialog.getAnimations === "function" ? dialog.getAnimations({ subtree: true }) : [];
      if (animations.length > 0) {
        await Promise.race([
          Promise.allSettled(animations.map((a) => a.finished)),
          new Promise((resolve) => setTimeout(resolve, 260)),
        ]);
      }
      dialog.removeAttribute("data-closing");
    }
    if (dialog.open) {
      dialog.close();
    }
    closingRef.current = false;
    setRendered(false);
  }, []);

  useEffect(() => {
    if (isOpen) {
      setRendered(true);
    }
  }, [isOpen]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (isOpen && rendered) {
      dialog.removeAttribute("data-closing");
      closingRef.current = false;
      if (!dialog.open) {
        dialog.showModal();
        if (initialFocusRef?.current) {
          requestAnimationFrame(() => initialFocusRef.current?.focus());
        } else {
          dialog.focus();
        }
      }
    } else if (!isOpen && dialog.open) {
      void performAnimatedClose(dialog);
    }
  }, [initialFocusRef, isOpen, performAnimatedClose, rendered]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    const handleCancel = (event: Event) => {
      event.preventDefault();
      onCloseRef.current();
    };

    const handleClose = () => {
      dialog.returnValue = "";
      if (isOpen) onCloseRef.current();
    };

    dialog.addEventListener("cancel", handleCancel);
    dialog.addEventListener("close", handleClose);

    // Fallback for browsers without native <dialog closedby="any">
    let pressedOutside = false;
    const isOutside = (e: PointerEvent) => {
      const r = dialog.getBoundingClientRect();
      return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
    };
    const handlePointerDown = (e: PointerEvent) => {
      if ("closedBy" in HTMLDialogElement.prototype) return;
      pressedOutside = isOutside(e);
    };
    const handlePointerUp = (e: PointerEvent) => {
      if ("closedBy" in HTMLDialogElement.prototype) return;
      if (pressedOutside && isOutside(e)) {
        onCloseRef.current();
      }
      pressedOutside = false;
    };

    dialog.addEventListener("pointerdown", handlePointerDown);
    dialog.addEventListener("pointerup", handlePointerUp);

    return () => {
      dialog.removeEventListener("cancel", handleCancel);
      dialog.removeEventListener("close", handleClose);
      dialog.removeEventListener("pointerdown", handlePointerDown);
      dialog.removeEventListener("pointerup", handlePointerUp);
    };
  }, [isOpen]);

  const content = rendered ? (
    <Box
      as={onSubmit ? "form" : "div"}
      onSubmit={onSubmit}
      position="relative"
      display="flex"
      flexDirection="column"
      w="100%"
      maxH="86dvh"
      minH={0}
    >
      <IconButton
        type="button"
        aria-label="关闭窗口"
        icon={<X size={17} />}
        size="sm"
        variant="ghost"
        position="absolute"
        top={3.5}
        right={3.5}
        color="ink.secondary"
        _hover={{ bg: "surface.hover", color: "ink.primary" }}
        _focus={{ boxShadow: "none" }}
        _focusVisible={{ boxShadow: "0 0 0 2px #0d0d0d" }}
        onClick={onClose}
        zIndex={10}
      />

      {title ? (
        <Box pt={5} pb={subtitle ? 1.5 : 3} px={6} pr={12} flexShrink={0}>
          <Text id={titleId} as="h2" fontSize="16px" fontWeight="600" color="ink.primary" lineHeight="1.35">
            {title}
          </Text>
          {subtitle ? (
            <Text fontSize="13px" fontWeight="400" color="ink.secondary" mt={1} lineHeight="1.5">
              {subtitle}
            </Text>
          ) : null}
        </Box>
      ) : null}

      <Box p={bodyPadding ?? (title ? "8px 24px 20px" : "24px")} flex={1} minH={0} overflowY="auto">
        {children}
      </Box>

      {footer ? (
        <Flex
          px={6}
          py={3.5}
          borderTop="1px solid"
          borderColor="stroke.light"
          justify="flex-end"
          align="center"
          gap={2}
          flexShrink={0}
        >
          {footer}
        </Flex>
      ) : null}
    </Box>
  ) : null;

  return (
    <dialog
      ref={dialogRef}
      tabIndex={-1}
      className="app-dialog"
      style={{ maxWidth: resolvedMaxW, borderRadius: cornerRadius }}
      aria-labelledby={title ? titleId : undefined}
      aria-label={!title ? ariaLabel : undefined}
      {...({ closedby: "any" } as Record<string, string>)}
    >
      {content}
    </dialog>
  );
}

export function AppPanelHeader({
  title,
  description,
  right,
}: {
  title: string;
  description?: string;
  right?: ReactNode;
}) {
  return (
    <Flex align="flex-start" justify="space-between" gap={4} mb={5} pr={8}>
      <Box>
        <Text fontSize="16px" fontWeight="600" color="ink.primary">
          {title}
        </Text>
        {description ? (
          <Text fontSize="13px" color="ink.secondary" mt={1}>
            {description}
          </Text>
        ) : null}
      </Box>
      {right}
    </Flex>
  );
}

export function AppPanelFooter({
  hint,
  children,
}: {
  hint?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Flex
      mt={6}
      pt={4}
      borderTop="1px solid"
      borderColor="stroke.light"
      justify="space-between"
      align="center"
      gap={3}
      flexWrap="wrap"
    >
      <Box fontSize="12.5px" color="ink.muted">
        {hint}
      </Box>
      <Flex gap={2} align="center">
        {children}
      </Flex>
    </Flex>
  );
}

export function AppSectionCard({ children, ...rest }: BoxProps) {
  return (
    <Box
      p={3.5}
      borderRadius="12px"
      bg="surface.sidebar"
      border="1px solid"
      borderColor="stroke.subtle"
      {...rest}
    >
      {children}
    </Box>
  );
}
