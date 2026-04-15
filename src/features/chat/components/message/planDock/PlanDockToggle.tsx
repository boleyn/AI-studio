import { Box, IconButton } from "@chakra-ui/react";
import { ChevronDown, ChevronUp } from "lucide-react";
import MyTooltip from "@/components/ui/MyTooltip";

type PlanDockToggleProps = {
  expanded: boolean;
  onToggle: () => void;
};

const PlanDockToggle = ({ expanded, onToggle }: PlanDockToggleProps) => {
  return (
    <MyTooltip label={expanded ? "收起计划详情" : "展开计划详情"}>
      <IconButton
        _hover={{ bg: "myGray.100" }}
        aria-label={expanded ? "收起计划详情" : "展开计划详情"}
        bg="transparent"
        border="1px solid"
        borderColor="myGray.200"
        borderRadius="8px"
        h="24px"
        icon={
          <Box as={expanded ? ChevronUp : ChevronDown} color="myGray.600" h="14px" w="14px" />
        }
        minW="24px"
        onClick={onToggle}
        size="xs"
        variant="ghost"
      />
    </MyTooltip>
  );
};

export default PlanDockToggle;
