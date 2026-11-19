import { Box } from "@chakra-ui/react";

export interface FileChatSizing {
  fileChatWidth:number;
  setFileChatWidth:(width:number)=>void;
}

export default function FileChatDivider({fileChatWidth,setFileChatWidth,breakpoint="md"}:FileChatSizing & {breakpoint?:"md" | "lg"}) {
  const clampChatWidth = (width:number) => Math.min(65,Math.max(25,width));
  return <Box role="separator" aria-label="调整聊天宽度" aria-orientation="vertical"
          aria-valuemin={25} aria-valuemax={65} aria-valuenow={fileChatWidth} aria-valuetext={fileChatWidth + "%"}
          tabIndex={0} display={{base:"none",md:breakpoint === "md" ? "block" : "none",lg:"block"}} position="absolute" insetY={0} left="-4px" w="8px"
          zIndex={5} cursor="col-resize" style={{touchAction:"none"}} _focusVisible={{outline:"2px solid currentColor"}}
          onPointerDown={event => {
            if (event.button === 0) event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={event => {
            if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
            const pane = event.currentTarget.parentElement;
            const containerWidth = pane?.parentElement?.getBoundingClientRect().width;
            if (!pane || !containerWidth) return;
            const width = pane.getBoundingClientRect().right - event.clientX;
            setFileChatWidth(clampChatWidth(Math.round(100 * width / containerWidth)));
          }}
          onKeyDown={event => {
            const widths: Record<string, number> = {ArrowLeft:fileChatWidth + 1, ArrowRight:fileChatWidth - 1, Home:25, End:65};
            if (Object.prototype.hasOwnProperty.call(widths, event.key)) {
              event.preventDefault();
              setFileChatWidth(clampChatWidth(widths[event.key]));
            }
          }}
        />;
}
