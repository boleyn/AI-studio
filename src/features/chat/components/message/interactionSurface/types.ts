import type { ChatInteractionContextValue } from "../../../context/ChatInteractionContext";

export type InteractionContext = ChatInteractionContextValue;
export type PendingInteraction = NonNullable<ChatInteractionContextValue["pendingInteraction"]>;
