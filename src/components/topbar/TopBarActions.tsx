import { Flex, IconButton } from "@chakra-ui/react";

import MyTooltip from "../ui/MyTooltip";
import type { SaveStatus } from "../CodeChangeListener";
import {
  DownloadIcon,
  RunIcon,
  SaveIcon,
  ShareIcon,
} from "../common/Icon";

type TopBarActionsProps = {
  saveStatus?: SaveStatus;
  onPreview?: () => void;
  onSave?: () => void;
  onDownload?: () => void;
  onShare?: () => void;
  shareLabel?: string;
  shareAriaLabel?: string;
};

const TopBarActions = ({
  saveStatus = "idle",
  onPreview,
  onSave,
  onDownload,
  onShare,
  shareLabel = "分享",
  shareAriaLabel = "分享",
}: TopBarActionsProps) => {
  const handleDownload = () => {
    onDownload?.();
  };


  const getSaveTooltipLabel = () => {
    switch (saveStatus) {
      case "saving":
        return "保存中...";
      case "saved":
        return "已保存";
      case "error":
        return "保存失败";
      default:
        return "保存";
    }
  };

  return (
    <Flex gap={1} align="center">
      <MyTooltip label="预览">
        <IconButton
          aria-label="预览"
          size="sm"
          variant="ghost"
          border="1px solid transparent"
          _hover={{ bg: "myGray.100", borderColor: "myGray.200" }}
          icon={<RunIcon />}
          onClick={onPreview}
        />
      </MyTooltip>
      <MyTooltip label="下载项目">
        <IconButton
          aria-label="下载项目"
          size="sm"
          variant="ghost"
          border="1px solid transparent"
          _hover={{ bg: "myGray.100", borderColor: "myGray.200" }}
          icon={<DownloadIcon />}
          onClick={handleDownload}
        />
      </MyTooltip>
      <MyTooltip label={shareLabel}>
        <IconButton
          aria-label={shareAriaLabel}
          size="sm"
          variant="ghost"
          border="1px solid transparent"
          _hover={{ bg: "myGray.100", borderColor: "myGray.200" }}
          icon={<ShareIcon />}
          onClick={onShare}
        />
      </MyTooltip>
      <MyTooltip label={getSaveTooltipLabel()}>
        <IconButton
          aria-label="保存"
          size="sm"
          variant="ghost"
          icon={<SaveIcon />}
          onClick={onSave}
          isLoading={saveStatus === "saving"}
          isDisabled={saveStatus === "saving"}
          border="1px solid transparent"
          _hover={{ bg: "myGray.100", borderColor: "myGray.200" }}
          colorScheme={
            saveStatus === "saved" ? "green" : saveStatus === "error" ? "red" : undefined
          }
        />
      </MyTooltip>
    </Flex>
  );
};

export default TopBarActions;
