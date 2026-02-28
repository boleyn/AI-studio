import { withAuthHeaders } from "@features/auth/client/authClient";

type MessageFeedback = "up" | "down" | undefined;

export const updateMessageFeedback = async ({
  token,
  conversationId,
  messageId,
  feedback,
}: {
  token: string;
  conversationId: string;
  messageId: string;
  feedback: MessageFeedback;
}) => {
  const response = await fetch("/api/chat/feedback", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...withAuthHeaders(),
    },
    body: JSON.stringify({
      token,
      conversationId,
      messageId,
      feedback,
    }),
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    const message = typeof payload?.error === "string" ? payload.error : "反馈更新失败";
    throw new Error(message);
  }
};
