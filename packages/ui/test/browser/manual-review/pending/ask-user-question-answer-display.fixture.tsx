import { useState } from "react";
import { createRoot } from "react-dom/client";
import { AskQuestionToolCallBlock } from "@/ToolCallBlocks/renderers/ask-question.js";
import type { ToolCallBlockRenderContext } from "@/ToolCallBlocks/shared.js";
import { ZCodeIntlProvider } from "@/i18n/IntlProvider.js";
import { Button } from "@/components/ui/button.js";
import "@/styles.css";

const params = new URLSearchParams(location.search);
const locale = params.get("locale") === "en-US" ? "en-US" : "zh-CN";
const theme = params.get("theme") === "dark" ? "dark" : "light";
document.documentElement.className = `${theme} theme-zai-${theme}`;
const noAnswer = locale === "en-US" ? "No answer provided" : "未提供回答";
const autoContinued =
  locale === "en-US" ? "No answer; continued automatically" : "未回答，已自动继续";
const questions = [
  { question: '是否开启"自动保存"？', options: [] },
  { question: " \n模式使用 [A+B] (.*) / C:\\demo？\n ", options: [] },
  { question: "是否保留“普通日志”？", options: [] },
  { question: '是否显示"详细日志"？', options: [] },
];
const answerTexts = [
  '"开启"，并保留 "草稿"',
  'A+B, C:\\demo\n下一行 "保留"',
  "标准",
  '"显示"\n保留完整日志',
];
const answers = Object.fromEntries(
  questions.map((question, index) => [question.question, answerTexts[index]]),
);
// 与 CLI 现有格式一致的固定语料；期望值直接来自输入，不能从产品解析函数计算。
const pairs = questions.map((question, index) => `"${question.question}"="${answerTexts[index]}"`);
const suffix = ". You can now continue with the user's answers in mind.";
const legacy = `User has answered your questions: ${pairs.join(", ")}${suffix}`;
const partial = `The user answered some questions and skipped 2. Provided answers: ${pairs[0]}, ${pairs[3]}. Continue with the provided answers and use your best judgment for the unanswered questions; do not invent user preferences.`;

interface DisplayCase {
  id: string;
  input?: unknown;
  output?: unknown;
  raw?: unknown;
  expected: string[];
  questionTexts?: string[];
}
const cases: DisplayCase[] = [
  { id: "legacy-four", output: legacy, expected: answerTexts },
  { id: "legacy-bare", output: pairs.join(", "), expected: answerTexts },
  {
    id: "nested-text",
    output: { content: [{ type: "text", text: legacy }] },
    expected: answerTexts,
  },
  {
    id: "raw-input-output",
    input: {},
    raw: { rawInput: { questions }, rawOutput: { content: [{ type: "text", text: legacy }] } },
    expected: answerTexts,
  },
  {
    id: "input-structured-priority",
    input: { questions, answers },
    output: partial,
    expected: answerTexts,
  },
  {
    id: "raw-structured-priority",
    output: partial,
    raw: { rawOutput: { answers } },
    expected: answerTexts,
  },
  {
    id: "json-text-block",
    output: { content: [{ type: "text", text: JSON.stringify({ answers }) }] },
    expected: answerTexts,
  },
  {
    id: "json-with-pair-text",
    output: JSON.stringify({
      answers: { ...answers, [questions[2].question]: '保留 "key"="value" 原文' },
    }),
    expected: [answerTexts[0], answerTexts[1], '保留 "key"="value" 原文', answerTexts[3]],
  },
  {
    id: "partial-text",
    output: partial,
    expected: [answerTexts[0], noAnswer, noAnswer, answerTexts[3]],
  },
  {
    id: "partial-structured",
    input: { questions, answers },
    output: { answers: { [questions[0].question]: answerTexts[0] } },
    expected: [answerTexts[0], noAnswer, noAnswer, noAnswer],
  },
  {
    id: "empty-structured",
    input: { questions, answers },
    output: { answers: {} },
    expected: questions.map(() => autoContinued),
  },
  {
    id: "empty-raw",
    output: legacy,
    raw: { rawOutput: { answers: {} } },
    expected: questions.map(() => autoContinued),
  },
  {
    id: "annotations",
    output: `User has answered your questions: ${pairs[0]} selected preview:\n[preview] user notes: note, ${pairs.slice(1).join(", ")}${suffix}`,
    expected: answerTexts,
  },
  {
    id: "legacy-single",
    input: { question: questions[0].question, options: [] },
    output: { type: "answered", selected: answerTexts[0] },
    expected: [answerTexts[0]],
    questionTexts: [questions[0].question],
  },
  {
    id: "legacy-single-custom",
    input: { question: questions[0].question, options: [] },
    raw: { rawOutput: JSON.stringify({ type: "answered_custom", text: answerTexts[0] }) },
    expected: [answerTexts[0]],
    questionTexts: [questions[0].question],
  },
];

const sharedContext = {
  nestedToolRenderer: () => null,
  workspacePath: "/fixture",
  displayModel: {
    inlinePreview: null,
    planResult: null,
    viewerSource: null,
    viewerLabelId: "codeViewer.viewCode",
    showSummaryFileLink: false,
    showInput: false,
    showOutput: false,
    showKind: false,
  },
  viewerSource: null,
  rawFileSummaries: [],
  isRunning: false,
  statusLabel: "",
  childToolList: null,
} satisfies Omit<ToolCallBlockRenderContext, "toolCallNode">;

function Fixture() {
  const [revision, setRevision] = useState(0);
  return (
    <main className="min-h-screen bg-background text-foreground p-4 space-y-4">
      <Button onClick={() => setRevision((value) => value + 1)}>Remount snapshot</Button>
      <div key={revision} data-revision={revision} className="space-y-4">
        {cases.map((entry) => (
          <section
            key={entry.id}
            data-case={entry.id}
            data-expected={JSON.stringify(entry.expected)}
            data-questions={JSON.stringify(
              entry.questionTexts ?? questions.map((question) => question.question),
            )}
          >
            <AskQuestionToolCallBlock
              {...sharedContext}
              toolCallNode={{
                childToolCalls: [],
                toolCall: JSON.parse(
                  JSON.stringify({
                    toolId: entry.id,
                    title: "AskUserQuestion",
                    kind: "ask",
                    status: "completed",
                    input: entry.input ?? { questions },
                    output: entry.output,
                    raw: entry.raw,
                  }),
                ),
              }}
            />
          </section>
        ))}
      </div>
    </main>
  );
}
createRoot(document.getElementById("root")!).render(
  <ZCodeIntlProvider initialLocale={locale}>
    <Fixture />
  </ZCodeIntlProvider>,
);
