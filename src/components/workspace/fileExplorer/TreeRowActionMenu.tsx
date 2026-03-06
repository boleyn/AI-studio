import { IconButton, Menu, MenuButton, MenuItem, MenuList, Text } from "@chakra-ui/react";

type TreeRowActionItem = {
  label: string;
  onClick: () => void;
};

type TreeRowActionMenuProps = {
  isVisible: boolean;
  iconSize: string;
  menuWidth: string;
  actions: TreeRowActionItem[];
};

const TreeRowActionMenu = ({ isVisible, iconSize, menuWidth, actions }: TreeRowActionMenuProps) => {
  return (
    <Menu placement="bottom-end" isLazy>
      <MenuButton
        as={IconButton}
        size="xs"
        variant="ghost"
        aria-label="行操作"
        icon={<Text lineHeight="1" fontSize={iconSize}>⋮</Text>}
        opacity={isVisible ? 1 : 0}
        borderRadius="8px"
        _groupHover={{ opacity: 1 }}
        onClick={(event) => event.stopPropagation()}
      />
      <MenuList minW={menuWidth} borderColor="var(--ws-border)" bg="var(--ws-surface-strong)">
        {actions.map((action) => (
          <MenuItem
            key={action.label}
            onClick={(event) => {
              event.stopPropagation();
              action.onClick();
            }}
          >
            {action.label}
          </MenuItem>
        ))}
      </MenuList>
    </Menu>
  );
};

export default TreeRowActionMenu;
