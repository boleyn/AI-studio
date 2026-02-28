import React from "react";

export const ChatBoxContext = React.createContext<any>({
  variableList: [],
  allVariableList: [],
  chatType: "chat",
  chatStartedWatch: false,
  hideVariableInput: false,
  isChatting: false
});
