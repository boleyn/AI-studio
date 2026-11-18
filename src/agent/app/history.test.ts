import { expect, test } from "bun:test";
import { toOpenAIHistory } from "./history";

test("an image stays with its user question and any interaction notes", () => {
  const question = {type:"text", text:"Read the cover"};
  const source = {type:"base64", media_type:"image/png", data:"aGVsbG8="};
  const messages = [{role:"user", content:[question, {type:"image", source}]}];
  const history = [{additional_kwargs:{permissionApprovalResponse:{decision:"allow", toolName:"Read"}}}];
  const [turn, ...remaining] = toOpenAIHistory(messages as Parameters<typeof toOpenAIHistory>[0], history);
  expect(remaining).toHaveLength(0);
  expect(turn.content).toEqual([
    question,
    {type:"image_url", image_url:{url:"data:image/png;base64,aGVsbG8="}},
    {type:"text", text:"[User approved permission for Read.]"},
  ]);
  const followUp = {role:"user" as const, content:"Thanks"};
  expect(toOpenAIHistory([...messages, followUp] as Parameters<typeof toOpenAIHistory>[0]).at(-1)).toEqual(followUp);
});
