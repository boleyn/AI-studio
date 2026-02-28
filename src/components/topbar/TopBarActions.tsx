import { Flex, IconButton } from "@chakra-ui/react";

import MyTooltip from "../ui/MyTooltip";
import type { SaveStatus } from "../CodeChangeListener";
import {
  CopyIcon,
  DownloadIcon,
  OpenInNewIcon,
  RefreshIcon,
  RunIcon,
  SaveIcon,
  ShareIcon,
} from "../common/Icon";

type TopBarActionsProps = {
  saveStatus?: SaveStatus;
  onSave?: () => void;
  onDownload?: () => void;
  onCopy?: () => void;
  onShare?: () => void;
  onRefresh?: () => void;
  onOpenInNew?: () => void;
};

const TopBarActions = ({
  saveStatus = "idle",
  onSave,
  onDownload,
  onCopy,
  onShare,
  onRefresh,
  onOpenInNew,
}: TopBarActionsProps) => {
  const handleCopy = () => {
    // 复制当前项目URL
    const url = window.location.href;
    navigator.clipboard.writeText(url);
    onCopy?.();
  };

  const handleDownload = () => {
    onDownload?.();
  };

  const handleRefresh = () => {
    // 刷新预览
    window.location.reload();
    onRefresh?.();
  };

  const handleOpenInNew = () => {
    // 在新标签页打开
    window.open(window.location.href, "_blank");
    onOpenInNew?.();
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
      <MyTooltip label="运行">
        <IconButton
          aria-label="运行"
          size="sm"
          variant="ghost"
          icon={<RunIcon />}
        />
      </MyTooltip>
      <MyTooltip label="复制链接">
        <IconButton
          aria-label="复制链接"
          size="sm"
          variant="ghost"
          icon={<CopyIcon />}
          onClick={handleCopy}
        />
      </MyTooltip>
      <MyTooltip label="在新标签页打开">
        <IconButton
          aria-label="在新标签页打开"
          size="sm"
          variant="ghost"
          icon={<OpenInNewIcon />}
          onClick={handleOpenInNew}
        />
      </MyTooltip>
      <MyTooltip label="刷新">
        <IconButton
          aria-label="刷新"
          size="sm"
          variant="ghost"
          icon={<RefreshIcon />}
          onClick={handleRefresh}
        />
      </MyTooltip>
      <MyTooltip label="下载项目">
        <IconButton
          aria-label="下载项目"
          size="sm"
          variant="ghost"
          icon={<DownloadIcon />}
          onClick={handleDownload}
        />
      </MyTooltip>
      <MyTooltip label="分享">
        <IconButton
          aria-label="分享"
          size="sm"
          variant="ghost"
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
          colorScheme={
            saveStatus === "saved" ? "green" : saveStatus === "error" ? "red" : undefined
          }
        />
      </MyTooltip>
    </Flex>
  );
};

export default TopBarActions;
