import { Button, Menu, MenuButton, MenuItem, MenuItemOption, MenuList, MenuOptionGroup, Text, HStack } from "@chakra-ui/react";
import { ChevronDown } from "lucide-react";

type Option = {
  value: string;
  label: string;
  status?: string;
  disabled?: boolean;
};

export default function ProjectWorkspaceSelect({
  labelId, value, placeholder, options, emptyMessage, statusMessage, onOpen, onChange,
}: {
  labelId: string;
  value: string;
  placeholder: string;
  options: Option[];
  emptyMessage?: string;
  statusMessage?: string;
  onOpen?: () => void;
  onChange: (value: string) => void;
}) {
  const selected = options.find(option => option.value === value);
  const valueId = `${labelId}-value`;
  return (
    <Menu matchWidth strategy="fixed" placement="bottom-start" gutter={4} isLazy onOpen={onOpen}>
      <MenuButton as={Button} type="button" size="sm" w="full" variant="outline"
        borderRadius="6px" bg="surface.canvas" borderColor="stroke.subtle"
        aria-labelledby={`${labelId} ${valueId}`} rightIcon={<ChevronDown size={14} aria-hidden="true" />}>
        <Text id={valueId} as="span" display="block" textAlign="left" noOfLines={1}>{selected?.label ?? placeholder}</Text>
      </MenuButton>
      <MenuList aria-labelledby={labelId} minW={0} maxH="min(216px, 40dvh)" overflowY="auto" zIndex={20} borderRadius="8px">
        {options.length > 0 && (
          <MenuOptionGroup type="radio" value={value}
            onChange={next => { if (typeof next === "string") onChange(next); }}>
            {options.map(option => (
              <MenuItemOption key={option.value} value={option.value} isDisabled={option.disabled} title={option.label}>
                <HStack minW={0} justify="space-between" spacing={2}>
                  <Text as="span" noOfLines={1}>{option.label}</Text>
                  {option.status && <Text as="span" fontSize="xs" color="ink.secondary" flexShrink={0}>{option.status}</Text>}
                </HStack>
              </MenuItemOption>
            ))}
          </MenuOptionGroup>
        )}
        {(statusMessage || (!options.length && emptyMessage)) && (
          <MenuItem isDisabled>{statusMessage || emptyMessage}</MenuItem>
        )}
      </MenuList>
    </Menu>
  );
}
