import { Button, Menu, MenuButton, MenuItemOption, MenuList, MenuOptionGroup } from "@chakra-ui/react";
import { ChevronDown } from "lucide-react";

const zoomLevels = [50, 75, 100, 125, 150, 200];

export function PreviewZoomMenu({ label, zoom, onChange }: {
  label: string;
  zoom: number;
  onChange: (zoom: number) => void;
}) {
  return (
    <Menu>
      <MenuButton as={Button} variant="ghost" size="sm" flexShrink={0} px={2}
        aria-label={`${label} ${zoom}%`} rightIcon={<ChevronDown size={14} />}>
        {zoom}%
      </MenuButton>
      <MenuList minW="120px">
        <MenuOptionGroup type="radio" value={String(zoom)} onChange={(value) => onChange(Number(value))}>
          {zoomLevels.map((level) => (
            <MenuItemOption key={level} value={String(level)}>{level}%</MenuItemOption>
          ))}
        </MenuOptionGroup>
      </MenuList>
    </Menu>
  );
}
