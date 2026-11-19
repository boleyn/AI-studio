import { useEffect, useState } from "react";
import { withAuthHeaders } from "@features/auth/client/authClient";

export default function useDriveConnected() {
  const [driveConnected,setDriveConnected] = useState(false);
  useEffect(() => {
    let pending: AbortController;
    function refreshConnection() {
      if (document.visibilityState !== "visible") return;
      pending?.abort();
      const controller = new AbortController();
      pending = controller;
      fetch("/api/library/connectors/google?status=1", {headers:withAuthHeaders(), signal:controller.signal})
        .then(async response => {
          if (!response.ok) return;
          const status = await response.json();
          if (!controller.signal.aborted) setDriveConnected(status.connected === true);
        }).catch(() => {});
    }
    refreshConnection();
    document.addEventListener("visibilitychange", refreshConnection);
    return () => {
      document.removeEventListener("visibilitychange", refreshConnection);
      pending?.abort();
    };
  }, []);
  return driveConnected;
}
