import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import PlanModeTimelineCard from "./PlanModeTimelineCard";

const renderCard = (toolName: string, interaction: Record<string, unknown>) =>
  renderToStaticMarkup(
    React.createElement(PlanModeTimelineCard, {
      toolItem: {
        toolName,
        interaction,
        progressStatus: "completed",
      },
      planModeApprovalDecision: "",
    })
  );

test("PlanModeTimelineCard supports both new and runtime tool names for question card", () => {
  const interaction = {
    type: "plan_question",
    requestId: "req-q-1",
    payload: {
      questions: [{ id: "q1", question: "继续吗？", options: [{ label: "确认执行" }] }],
    },
  };
  const newNameHtml = renderCard("request_user_input", interaction);
  const runtimeNameHtml = renderCard("askuserquestion", interaction);

  assert.match(newNameHtml, /计划问题已生成/);
  assert.match(runtimeNameHtml, /计划问题已生成/);
});

test("PlanModeTimelineCard supports both new and runtime tool names for approval card", () => {
  const interaction = {
    type: "plan_approval",
    requestId: "req-a-1",
    payload: {
      action: "exit",
      title: "计划已完成，是否进入执行？",
    },
  };
  const newNameHtml = renderCard("exit_plan_mode", interaction);
  const runtimeNameHtml = renderCard("exitplanmode", interaction);

  assert.match(newNameHtml, /请在消息末尾的计划确认区域完成审批操作/);
  assert.match(runtimeNameHtml, /请在消息末尾的计划确认区域完成审批操作/);
});
