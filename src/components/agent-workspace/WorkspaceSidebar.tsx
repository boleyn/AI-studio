import { forwardRef, type ReactNode } from "react";
import {
  Box,
  Button,
  Flex,
  HStack,
  IconButton,
  type BoxProps,
  type ButtonProps,
  type FlexProps,
  type IconButtonProps,
} from "@chakra-ui/react";

export const SIDEBAR_DEFAULT_WIDTH = 260;
export const SIDEBAR_MIN_WIDTH = 220;
export const SIDEBAR_MAX_WIDTH = 420;
export const SIDEBAR_ICON_SIZE = 16;

export const sidebarHeaderIconButtonProps: Partial<IconButtonProps> = {
  size: "sm",
  variant: "ghost",
  boxSize: "28px",
  minW: "28px",
  borderRadius: "8px",
  color: "ink.secondary",
  _hover: { bg: "surface.hover", color: "ink.primary" },
  _active: { bg: "surface.active" },
  _expanded: { bg: "surface.active", color: "ink.primary" },
};

export const SidebarHeaderIconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  function SidebarHeaderIconButton(props, ref) {
    return <IconButton ref={ref} {...sidebarHeaderIconButtonProps} {...props} />;
  },
);

export const sidebarActionButtonProps: Partial<ButtonProps> = {
  size: "sm",
  variant: "ghost",
  w: "full",
  h: "34px",
  px: 2.5,
  borderRadius: "8px",
  justifyContent: "flex-start",
  fontWeight: "400",
  fontSize: "13.5px",
  color: "ink.primary",
  iconSpacing: "8px",
  _hover: { bg: "surface.hover" },
  _active: { bg: "surface.active" },
};

export const SidebarActionButton = forwardRef<HTMLButtonElement, ButtonProps>(
  function SidebarActionButton(props, ref) {
    return <Button ref={ref} {...sidebarActionButtonProps} {...props} />;
  },
);

export const sidebarNavItemProps: Partial<ButtonProps> = {
  size: "sm",
  variant: "ghost",
  w: "full",
  h: "34px",
  px: 2.5,
  borderRadius: "8px",
  justifyContent: "flex-start",
  fontWeight: "400",
  fontSize: "13.5px",
  color: "ink.primary",
  iconSpacing: "8px",
  _hover: { bg: "surface.hover" },
  _active: { bg: "surface.active" },
};

type SidebarSectionHeaderProps = {
  label: ReactNode;
  id?: string;
  action?: ReactNode;
  onToggle?: () => void;
  isExpanded?: boolean;
  mt?: FlexProps["mt"];
  mb?: FlexProps["mb"];
};

export function SidebarSectionHeader({
  label,
  id,
  action,
  onToggle,
  isExpanded,
  mt,
  mb = 0.5,
}: SidebarSectionHeaderProps) {
  return (
    <Flex align="center" justify="space-between" minH="28px" mt={mt} mb={mb} px={onToggle ? 0.5 : 2.5}>
      {onToggle ? (
        <Button
          id={id}
          variant="ghost"
          size="xs"
          h="28px"
          px={2}
          flex="1"
          justifyContent="flex-start"
          fontSize="12px"
          fontWeight="500"
          color="ink.muted"
          borderRadius="6px"
          _hover={{ bg: "surface.hover", color: "ink.primary" }}
          aria-expanded={isExpanded}
          onClick={onToggle}
        >
          {label}
        </Button>
      ) : (
        <Box
          id={id}
          fontSize="12px"
          fontWeight="500"
          color="ink.muted"
          lineHeight="1.3"
        >
          {label}
        </Box>
      )}
      {action}
    </Flex>
  );
}

type WorkspaceSidebarProps = Omit<FlexProps, "title"> & {
  title: ReactNode;
  headerActions?: ReactNode;
  search?: ReactNode;
  primaryAction?: ReactNode;
  topContent?: ReactNode;
  footer?: ReactNode;
  widthPx?: number;
  onWidthChange?: (width: number) => void;
  resizeLabel?: string;
  bodyProps?: FlexProps;
  footerProps?: BoxProps;
};

export default function WorkspaceSidebar({
  title,
  headerActions,
  search,
  primaryAction,
  topContent,
  footer,
  widthPx,
  onWidthChange,
  resizeLabel = "调整侧边栏宽度",
  bodyProps,
  footerProps,
  children,
  w,
  ...rest
}: WorkspaceSidebarProps) {
  const effectiveWidth = widthPx ?? SIDEBAR_DEFAULT_WIDTH;
  const clampWidth = (value: number) =>
    Math.max(SIDEBAR_MIN_WIDTH, Math.min(SIDEBAR_MAX_WIDTH, value));

  return (
    <Flex
      position="relative"
      direction="column"
      flexShrink={0}
      minH={0}
      w={w ?? (widthPx !== undefined ? `${widthPx}px` : `${SIDEBAR_DEFAULT_WIDTH}px`)}
      bg="surface.sidebar"
      borderRight="1px solid"
      borderColor="stroke.light"
      color="ink.primary"
      {...rest}
    >
      {/* 统一顶部标题栏 */}
      <Flex
        h="52px"
        px={3}
        align="center"
        justify="space-between"
        gap={1.5}
        flexShrink={0}
      >
        <Flex
          align="center"
          minW={0}
          flex="1"
          fontSize="15.5px"
          fontWeight="600"
          lineHeight="1.3"
          color="ink.primary"
          pl={0.5}
        >
          {title}
        </Flex>
        {headerActions && (
          <HStack spacing={0.5} flexShrink={0}>
            {headerActions}
          </HStack>
        )}
      </Flex>

      {search && (
        <Box px={2} pb={2} flexShrink={0}>
          {search}
        </Box>
      )}

      {primaryAction && (
        <Box px={2} pb={2} flexShrink={0}>
          {primaryAction}
        </Box>
      )}

      {topContent && (
        <Box px={2} pb={2} flexShrink={0}>
          {topContent}
        </Box>
      )}

      <Flex
        direction="column"
        flex="1"
        minH={0}
        overflowY="auto"
        px={2}
        pb={4}
        {...bodyProps}
      >
        {children}
      </Flex>

      {footer && (
        <Box px={2} py={2} flexShrink={0} {...footerProps}>
          {footer}
        </Box>
      )}

      {onWidthChange && (
        <Box
          role="separator"
          aria-label={resizeLabel}
          aria-orientation="vertical"
          tabIndex={0}
          aria-valuemin={SIDEBAR_MIN_WIDTH}
          aria-valuemax={SIDEBAR_MAX_WIDTH}
          aria-valuenow={effectiveWidth}
          aria-valuetext={`${effectiveWidth} 像素`}
          position="absolute"
          right="-4px"
          insetY={0}
          w="8px"
          zIndex={1}
          cursor="col-resize"
          style={{ touchAction: "none" }}
          userSelect="none"
          _hover={{ bg: "blackAlpha.100" }}
          _focusVisible={{ outline: "2px solid currentColor" }}
          onPointerDown={(event) => {
            if (event.button === 0) {
              event.currentTarget.setPointerCapture(event.pointerId);
            }
          }}
          onPointerMove={(event) => {
            const handle = event.currentTarget;
            if (handle.hasPointerCapture(event.pointerId) && handle.parentElement) {
              onWidthChange(
                clampWidth(event.clientX - handle.parentElement.getBoundingClientRect().left),
              );
            }
          }}
          onKeyDown={(event) => {
            if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
            event.preventDefault();
            const current = event.currentTarget.parentElement?.getBoundingClientRect().width;
            if (current) {
              onWidthChange(clampWidth(current + (event.key === "ArrowLeft" ? -8 : 8)));
            }
          }}
        />
      )}
    </Flex>
  );
}
