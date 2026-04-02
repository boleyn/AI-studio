import type { NextApiRequest, NextApiResponse } from "next";

type BindWorkflowAbortToConnectionInput = {
  req: NextApiRequest;
  res: NextApiResponse;
  controller: AbortController;
  scope: string;
};

const getConnectionStateSnapshot = (req: NextApiRequest, res: NextApiResponse) => {
  const reqLike = req as NextApiRequest & {
    readableEnded?: boolean;
    complete?: boolean;
    destroyed?: boolean;
    aborted?: boolean;
  };
  const readableEnded = Boolean(reqLike.readableEnded ?? reqLike.complete);
  return {
    reqReadableEnded: readableEnded,
    reqDestroyed: Boolean(reqLike.destroyed),
    reqAborted: Boolean(reqLike.aborted),
    resWritableEnded: Boolean(res.writableEnded),
    resDestroyed: Boolean(res.destroyed),
  };
};

export const bindWorkflowAbortToConnection = ({
  req,
  res,
  controller,
  scope,
}: BindWorkflowAbortToConnectionInput) => {
  const abortWithReason = (reason: string) => {
    if (controller.signal.aborted) return;
    const snapshot = getConnectionStateSnapshot(req, res);
    console.warn("[agent-debug][disconnect-abort-workflow]", {
      scope,
      reason,
      ...snapshot,
    });
    controller.abort(new Error("client_disconnected"));
  };

  // Node docs: IncomingMessage "close" is emitted when request is completed too.
  // Only treat it as disconnect if request body did not end gracefully.
  const onReqClose = () => {
    const snapshot = getConnectionStateSnapshot(req, res);
    if (snapshot.reqReadableEnded) {
      console.info("[agent-debug][disconnect-ignore]", {
        scope,
        source: "req_close_completed",
        ...snapshot,
      });
      return;
    }
    abortWithReason("req_close_before_readable_end");
  };

  // Deprecated in docs but still emitted in some stacks; keep as strong signal.
  const onReqAborted = () => abortWithReason("req_aborted_event");

  // For streaming responses, "close" before writable end means peer disconnected.
  const onResClose = () => {
    const snapshot = getConnectionStateSnapshot(req, res);
    if (snapshot.resWritableEnded) {
      console.info("[agent-debug][disconnect-ignore]", {
        scope,
        source: "res_close_after_writable_end",
        ...snapshot,
      });
      return;
    }
    abortWithReason("res_close_before_writable_end");
  };

  req.once("close", onReqClose);
  req.once("aborted", onReqAborted);
  res.once("close", onResClose);

  return () => {
    req.off("close", onReqClose);
    req.off("aborted", onReqAborted);
    res.off("close", onResClose);
  };
};

