type ZCodeUserQuestionAnswers = Record<string, unknown>;

type AskUserQuestionType = "single" | "multiple";

interface AskUserQuestionOption {
  id: string;
  label: string;
  description?: string;
  placeholder?: string;
  requiresInput: boolean;
}

interface AskUserQuestionItem {
  id: string;
  question: string;
  type: AskUserQuestionType;
  options: AskUserQuestionOption[];
  customInput?: AskUserQuestionOption;
}

interface AskUserQuestionData {
  questions: AskUserQuestionItem[];
  answers?: ZCodeUserQuestionAnswers;
}

interface AskUserQuestionAnswerDraft {
  selectedOptionIds: string[];
  customInput: string;
}

const CUSTOM_INPUT_FLAGS = [
  "requiresInput",
  "customInput",
  "isCustom",
  "freeText",
  "allowFreeText",
] as const;
const CUSTOM_INPUT_LABEL_PATTERN =
  /(其他|其它|自定义|自行|自己|补充|填写|填入|输入|other|custom|free\s*text|specify|write\s*in)/i;

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(record: Record<string, unknown>, keys: readonly string[]) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value;
    }
  }
  return undefined;
}

function readBoolean(record: Record<string, unknown>, keys: readonly string[]) {
  return keys.some((key) => record[key] === true);
}

function normalizeOption(value: unknown, index: number): AskUserQuestionOption | null {
  if (typeof value === "string") {
    return {
      id: `option-${index}`,
      label: value,
      requiresInput: false,
    };
  }

  if (!isPlainRecord(value)) {
    return null;
  }

  const label =
    readString(value, ["label", "name", "title", "text", "value"]) ?? JSON.stringify(value);
  const id = readString(value, ["id", "optionId", "value", "key"]) ?? label;
  const placeholder = readString(value, [
    "placeholder",
    "customInputPlaceholder",
    "freeTextPlaceholder",
    "inputPlaceholder",
  ]);

  return {
    id,
    label,
    description: readString(value, ["description", "detail", "help", "hint"]),
    placeholder,
    requiresInput:
      readBoolean(value, CUSTOM_INPUT_FLAGS) || (index >= 0 && placeholder !== undefined),
  };
}

function isImplicitCustomInputOption(option: AskUserQuestionOption | undefined) {
  if (!option) {
    return false;
  }
  return CUSTOM_INPUT_LABEL_PATTERN.test(option.label);
}

function readQuestions(input: unknown): unknown[] {
  if (!isPlainRecord(input)) {
    return [];
  }
  const questions = input.questions;
  if (Array.isArray(questions)) {
    return questions;
  }
  // Bugfix: ZCode Agent 的 AskUserQuestion 工具输入是单题结构：
  // { header, question, options }，不是多题结构 { questions: [...] }。
  // 这里把单题结构归一化成同一条 questions 管线，避免消息流工具块显示“没有可回答的问题”。
  return typeof input.question === "string" && Array.isArray(input.options) ? [input] : [];
}

function readAnswers(input: unknown): ZCodeUserQuestionAnswers | undefined {
  if (!isPlainRecord(input)) {
    return undefined;
  }
  const answers = input.answers;
  return isPlainRecord(answers) ? answers : undefined;
}

function parseTextAskUserQuestionOutput(
  output: unknown,
  questions: AskUserQuestionItem[],
): ZCodeUserQuestionAnswers | undefined {
  if (typeof output !== "string" || questions.length === 0) {
    return undefined;
  }

  // 工具文本未转义题干/答案里的引号；旧的 [^"] 正则会截断 key 或答案，
  // 即使模型收到完整回答也显示“未提供回答”。按原始题干和结果边界读取，不 trim key。
  const questionPattern = questions
    .map(({ question }) => question.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("|");
  const answerPattern = new RegExp(
    `"(${questionPattern})"="([\\s\\S]*?)"` +
      `(?=, "(?:${questionPattern})"="| selected preview:\\n| user notes: |` +
      "\\. You can now continue with the user's answers in mind\\.\\s*$|" +
      "\\. Continue with the provided answers and use your best judgment for the unanswered questions; do not invent user preferences\\.\\s*$|\\s*$)",
    "g",
  );
  const answers: ZCodeUserQuestionAnswers = {};
  for (const match of output.matchAll(answerPattern)) {
    const question = match[1];
    if (!question) {
      continue;
    }
    answers[question] = match[2] ?? "";
  }

  return Object.keys(answers).length > 0 ? answers : undefined;
}

function parseJsonRecord(output: unknown): Record<string, unknown> | undefined {
  if (isPlainRecord(output)) {
    return output;
  }
  if (typeof output !== "string" || output.trim().length === 0) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(output) as unknown;
    return isPlainRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function readNestedAskUserQuestionAnswers(
  input: unknown,
  questions: AskUserQuestionItem[],
  allowText: boolean,
): ZCodeUserQuestionAnswers | undefined {
  if (Array.isArray(input)) {
    for (const item of input) {
      const answers = readNestedAskUserQuestionAnswers(item, questions, allowText);
      if (answers) return answers;
    }
    return undefined;
  }

  const record = parseJsonRecord(input);
  if (!record) {
    return allowText ? parseTextAskUserQuestionOutput(input, questions) : undefined;
  }

  const directAnswers =
    readAnswers(record) ?? parseZCodeAskUserQuestionOutput(record, questions[0]);
  if (directAnswers) {
    return directAnswers;
  }

  for (const nested of [record.content, record.text, record.rawOutput, record.output]) {
    const answers = readNestedAskUserQuestionAnswers(nested, questions, allowText);
    if (answers) return answers;
  }
  return undefined;
}

function parseZCodeAskUserQuestionOutput(
  output: unknown,
  question: AskUserQuestionItem | undefined,
): ZCodeUserQuestionAnswers | undefined {
  const outputRecord = parseJsonRecord(output);
  if (!outputRecord) {
    return undefined;
  }

  if (!question) {
    return undefined;
  }

  const type = outputRecord.type;
  const rawAnswer =
    type === "answered"
      ? outputRecord.selected
      : type === "answered_custom"
        ? outputRecord.text
        : undefined;
  if (typeof rawAnswer !== "string") {
    return undefined;
  }

  return {
    [question.question]: rawAnswer,
  };
}

function normalizeQuestion(value: unknown, index: number): AskUserQuestionItem | null {
  if (!isPlainRecord(value)) {
    return null;
  }

  const question = readString(value, ["question", "prompt", "label", "title", "text"]);
  if (!question) {
    return null;
  }

  const rawOptions = Array.isArray(value.options) ? value.options : [];
  const options = rawOptions
    .map((option, optionIndex) => normalizeOption(option, optionIndex))
    .filter((option): option is AskUserQuestionOption => option !== null);
  const questionPlaceholder = readString(value, [
    "customInputPlaceholder",
    "freeTextPlaceholder",
    "inputPlaceholder",
  ]);
  const lastOption = options.at(-1);
  const lastOptionIsCustomInput =
    lastOption !== undefined &&
    (lastOption.requiresInput === true || isImplicitCustomInputOption(lastOption));
  const customInput =
    lastOptionIsCustomInput && lastOption
      ? {
          ...lastOption,
          placeholder: lastOption.placeholder ?? lastOption.label,
          requiresInput: true,
        }
      : questionPlaceholder
        ? {
            id: `custom-${index}`,
            label: questionPlaceholder,
            placeholder: questionPlaceholder,
            requiresInput: true,
          }
        : undefined;
  const normalizedOptions = lastOptionIsCustomInput ? options.slice(0, -1) : options;
  const type =
    value.multiple === true ||
    value.multiSelect === true ||
    value.type === "multiple" ||
    value.type === "multi"
      ? "multiple"
      : "single";

  return {
    id: readString(value, ["id", "key", "name"]) ?? `question-${index}`,
    question,
    type,
    options: normalizedOptions,
    customInput,
  };
}

export function normalizeAskUserQuestionInput(input: unknown): AskUserQuestionData {
  return {
    questions: readQuestions(input)
      .map((question, index) => normalizeQuestion(question, index))
      .filter((question): question is AskUserQuestionItem => question !== null),
    answers: readAnswers(input),
  };
}

export function readAskUserQuestionInput(value: {
  input?: unknown;
  output?: unknown;
  raw?: unknown;
}): unknown {
  if (readQuestions(value.input).length > 0) {
    return value.input;
  }
  if (isPlainRecord(value.raw)) {
    if (readQuestions(value.raw.rawInput).length > 0) {
      return value.raw.rawInput;
    }
    if (readQuestions(value.raw.input).length > 0) {
      return value.raw.input;
    }
  }
  return value.input;
}

export function readAskUserQuestionAnswers(value: {
  input?: unknown;
  output?: unknown;
  raw?: unknown;
}): ZCodeUserQuestionAnswers | undefined {
  const { questions } = normalizeAskUserQuestionInput(readAskUserQuestionInput(value));
  const raw = isPlainRecord(value.raw) ? value.raw : undefined;
  const sources = [
    value.output,
    raw?.rawOutput,
    raw?.output,
    raw?.content,
    value.input,
    raw?.rawInput,
    raw?.input,
  ];
  // 文本可能只解析出部分题目，不能因此抢先返回并遮蔽结构化答案。
  // 先遍历所有结构化来源（包括显式空 answers），再兼容旧历史文本，不合并两份事实。
  for (const allowText of [false, true]) {
    for (const source of sources) {
      const answers = readNestedAskUserQuestionAnswers(source, questions, allowText);
      if (answers) return answers;
    }
  }
  return undefined;
}

export function getAskUserQuestionAnswerText(
  question: AskUserQuestionItem,
  answers: ZCodeUserQuestionAnswers | undefined,
  noAnswerText: string,
) {
  const value = answers?.[question.question] ?? answers?.[question.id];
  if (Array.isArray(value)) {
    const values = value.map((item) => String(item).trim()).filter((item) => item.length > 0);
    return values.length > 0 ? values.join("，") : noAnswerText;
  }
  if (typeof value === "string") {
    return value.trim().length > 0 ? value : noAnswerText;
  }
  if (value === undefined || value === null) {
    return noAnswerText;
  }
  return String(value);
}
