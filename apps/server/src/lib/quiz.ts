import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";

// Bring-your-own-key: the host supplies their own provider + API key on each
// request. Keys are used transiently to make one call and are never stored.
export type QuizProvider = "anthropic" | "openai" | "openrouter";

export interface GeneratedQuestion {
  question: string;
  options: string[];
  correctIndex: number;
}

// A friendly, HTTP-mappable failure. The message is shown to the host, so it
// has to make sense to a teacher — not leak SDK internals.
export class QuizError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "QuizError";
    this.status = status;
  }
}

// Both providers accept this JSON Schema. Structured outputs can't express
// min/max counts, so option counts are clamped after parsing.
const QUIZ_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["questions"],
  properties: {
    questions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["question", "options", "correctIndex"],
        properties: {
          question: { type: "string" },
          options: { type: "array", items: { type: "string" } },
          correctIndex: { type: "integer" },
        },
      },
    },
  },
} as const;

const MAX_OPTIONS = 6;
const PAID_TIMEOUT_MS = 60_000;
const ANTHROPIC_MODEL = "claude-sonnet-5";
const OPENAI_MODEL = "gpt-4o-mini";

const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

// Free OpenRouter models, tried in order. Hosts never choose a model, so if one
// is retired or rate-limited we fall through to the next rather than breaking
// generation for everyone. `schema` marks models that can be constrained with a
// JSON schema; the rest fall back to prompt-and-parse.
//
// These ids DO get retired — verify against the live list if generation starts
// failing across the board:
//   curl -s https://openrouter.ai/api/v1/models | grep ':free'
const OPENROUTER_MODELS: { id: string; schema: boolean }[] = [
  { id: "nvidia/nemotron-3-super-120b-a12b:free", schema: true },
  { id: "qwen/qwen3-next-80b-a3b-instruct:free", schema: true },
  { id: "openai/gpt-oss-20b:free", schema: true },
  { id: "meta-llama/llama-3.3-70b-instruct:free", schema: false },
];

// Free models queue, and rate-limited ones would otherwise be retried with
// backoff on every model in the chain — that reads to the host as a hang. Bound
// both a single attempt and the whole walk through the list.
const OPENROUTER_ATTEMPT_TIMEOUT_MS = 30_000;
const OPENROUTER_TOTAL_BUDGET_MS = 75_000;

// `jsonOnly` is for models we can't constrain with a schema (the free
// OpenRouter tier) — there the format has to be asked for in words.
function buildPrompt(text: string, count: number, jsonOnly = false): string {
  const format = jsonOnly
    ? `

Reply with nothing but a JSON object in exactly this shape — no prose, no markdown fences:
{"questions":[{"question":"...","options":["...","...","...","..."],"correctIndex":0}]}`
    : "";

  return `You are helping a teacher turn their presentation into a quick comprehension check for their students.

From the slide/deck content below, write ${count} multiple-choice questions that test whether students understood the key ideas.

Rules:
- Base every question strictly on the content provided. Never invent facts it doesn't support.
- Give each question 4 options when the content allows it, and never fewer than 2.
- Exactly one option is correct. "correctIndex" is that option's 0-based position in "options".
- Make the wrong options plausible but clearly incorrect to someone who understood the material.
- Keep questions and answers short and classroom-friendly.
- Write in the same language as the source content.${format}

Slide/deck content:
"""
${text}
"""`;
}

/**
 * Parse JSON from a model we couldn't constrain with a schema. Free models tend
 * to wrap their answer in markdown fences or a sentence of preamble, so strip
 * those before giving up.
 */
export function parseLooseJson(text: string): unknown {
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/, "")
    .trim();

  try {
    return JSON.parse(cleaned);
  } catch {
    // Fall back to the outermost {...} in case there's prose around it.
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start !== -1 && end > start) {
      try {
        return JSON.parse(cleaned.slice(start, end + 1));
      } catch {
        /* fall through */
      }
    }
  }
  throw new QuizError("The AI returned a response we couldn't read. Try again.", 502);
}

// Trust nothing from the model: drop malformed questions, compact blank
// options, and pin correctIndex into range so a stray value can't mark the
// wrong answer correct.
export function normalize(raw: unknown): GeneratedQuestion[] {
  const list =
    raw && typeof raw === "object" && Array.isArray((raw as any).questions)
      ? (raw as any).questions
      : [];

  const out: GeneratedQuestion[] = [];
  for (const q of list) {
    if (!q || typeof q.question !== "string" || !q.question.trim()) continue;

    const rawOptions: unknown[] = Array.isArray(q.options) ? q.options : [];
    const rawCorrect = Number.isInteger(q.correctIndex) ? (q.correctIndex as number) : 0;

    // Compact blanks and remap the correct-answer index as we go — dropping an
    // option shifts everything after it, so a fixed index would end up marking
    // a different answer correct.
    const options: string[] = [];
    let correctIndex = -1;
    for (let i = 0; i < rawOptions.length && options.length < MAX_OPTIONS; i++) {
      const opt = rawOptions[i];
      if (typeof opt !== "string" || !opt.trim()) continue;
      if (i === rawCorrect) correctIndex = options.length;
      options.push(opt.trim().slice(0, 100));
    }

    if (options.length < 2) continue;
    // The marked answer was blank or past the cap. These are drafts the host
    // reviews before use, so fall back to the first answer rather than drop it.
    if (correctIndex < 0) correctIndex = 0;

    out.push({ question: q.question.trim().slice(0, 200), options, correctIndex });
  }
  return out;
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw new QuizError("The AI returned a response we couldn't read. Try again.", 502);
  }
}

async function withAnthropic(apiKey: string, text: string, count: number): Promise<GeneratedQuestion[]> {
  // Bounded so a slow or rate-limited provider surfaces an error instead of
  // leaving the host watching a spinner.
  const client = new Anthropic({ apiKey, timeout: PAID_TIMEOUT_MS, maxRetries: 1 });
  try {
    const res = await client.messages.create({
      model: ANTHROPIC_MODEL,
      max_tokens: 4000,
      output_config: {
        effort: "low",
        format: { type: "json_schema", schema: QUIZ_SCHEMA },
      },
      messages: [{ role: "user", content: buildPrompt(text, count) }],
    });
    const block = res.content.find((b): b is Anthropic.TextBlock => b.type === "text");
    if (!block) throw new QuizError("Claude returned no content. Try again.", 502);
    return normalize(parseJson(block.text));
  } catch (err) {
    throw mapAnthropicError(err);
  }
}

function mapAnthropicError(err: unknown): QuizError {
  if (err instanceof QuizError) return err;
  if (err instanceof Anthropic.AuthenticationError)
    return new QuizError("Your Claude API key was rejected. Double-check it and try again.", 401);
  if (err instanceof Anthropic.PermissionDeniedError)
    return new QuizError("This Claude key isn't allowed to use that model. Check your plan.", 403);
  if (err instanceof Anthropic.RateLimitError)
    return new QuizError("Your Claude key is out of quota or rate-limited. Add credit or wait a moment.", 429);
  if (err instanceof Anthropic.APIError)
    return new QuizError(err.message || "Claude request failed.", err.status ?? 502);
  return new QuizError("Couldn't reach Claude. Check your connection and try again.", 502);
}

async function withOpenAI(apiKey: string, text: string, count: number): Promise<GeneratedQuestion[]> {
  const client = new OpenAI({ apiKey, timeout: PAID_TIMEOUT_MS, maxRetries: 1 });
  try {
    const res = await client.chat.completions.create({
      model: OPENAI_MODEL,
      response_format: {
        type: "json_schema",
        json_schema: { name: "quiz", strict: true, schema: QUIZ_SCHEMA },
      },
      messages: [
        { role: "system", content: "You output only JSON matching the provided schema." },
        { role: "user", content: buildPrompt(text, count) },
      ],
    });
    const content = res.choices[0]?.message?.content;
    if (!content) throw new QuizError("OpenAI returned no content. Try again.", 502);
    return normalize(parseJson(content));
  } catch (err) {
    throw mapOpenAIError(err);
  }
}

function mapOpenAIError(err: unknown): QuizError {
  if (err instanceof QuizError) return err;
  if (err instanceof OpenAI.AuthenticationError)
    return new QuizError("Your OpenAI API key was rejected. Double-check it and try again.", 401);
  if (err instanceof OpenAI.PermissionDeniedError)
    return new QuizError("This OpenAI key isn't allowed to use that model. Check your plan.", 403);
  if (err instanceof OpenAI.RateLimitError)
    return new QuizError("Your OpenAI key is out of quota or rate-limited. Add billing or wait a moment.", 429);
  if (err instanceof OpenAI.APIError)
    return new QuizError(err.message || "OpenAI request failed.", err.status ?? 502);
  return new QuizError("Couldn't reach OpenAI. Check your connection and try again.", 502);
}

/**
 * OpenRouter's free tier — the only path that works without a payment method.
 * These models can't be relied on to honour a JSON schema, so the format is
 * requested in the prompt and parsed defensively. Models are tried in order so
 * one being retired or rate-limited doesn't break generation.
 */
async function withOpenRouter(apiKey: string, text: string, count: number): Promise<GeneratedQuestion[]> {
  const client = new OpenAI({
    apiKey,
    baseURL: OPENROUTER_BASE_URL,
    timeout: OPENROUTER_ATTEMPT_TIMEOUT_MS,
    // Don't let the SDK retry a rate-limited free model with backoff — we'd
    // rather move on to the next model in the chain immediately.
    maxRetries: 0,
    defaultHeaders: { "X-Title": "Presento" },
  });

  const startedAt = Date.now();
  let lastError: QuizError | null = null;

  for (const model of OPENROUTER_MODELS) {
    if (Date.now() - startedAt > OPENROUTER_TOTAL_BUDGET_MS) break;
    try {
      const res = await client.chat.completions.create({
        model: model.id,
        messages: [
          { role: "system", content: "You reply with raw JSON only. Never use markdown fences." },
          { role: "user", content: buildPrompt(text, count, true) },
        ],
        // Constrain the models that can be; the rest rely on the prompt.
        ...(model.schema
          ? {
              response_format: {
                type: "json_schema" as const,
                json_schema: { name: "quiz", strict: true, schema: QUIZ_SCHEMA },
              },
            }
          : {}),
      });

      const content = res.choices[0]?.message?.content;
      if (!content) throw new QuizError("That model returned nothing.", 502);

      // Loose parsing even on the schema path — free providers don't always
      // honour the constraint, and it costs nothing when they do.
      const questions = normalize(parseLooseJson(content));
      // Parsed but unusable is worth retrying on the next model — weaker free
      // models sometimes answer in prose.
      if (questions.length === 0) throw new QuizError("That model returned no usable questions.", 502);
      return questions;
    } catch (err) {
      const mapped = mapOpenRouterError(err);
      // A bad key or empty balance fails identically on every model — stop.
      if (mapped.status === 401 || mapped.status === 402) throw mapped;
      console.error(`OpenRouter model ${model.id} failed:`, mapped.message);
      lastError = mapped;
    }
  }

  throw (
    lastError ??
    new QuizError("Couldn't reach OpenRouter. Check your connection and try again.", 502)
  );
}

function mapOpenRouterError(err: unknown): QuizError {
  if (err instanceof QuizError) return err;
  if (err instanceof OpenAI.AuthenticationError)
    return new QuizError("Your OpenRouter API key was rejected. Double-check it and try again.", 401);
  if (err instanceof OpenAI.RateLimitError)
    return new QuizError(
      "OpenRouter's free tier is rate-limited right now. Wait a moment and try again.",
      429,
    );
  if (err instanceof OpenAI.APIError) {
    if (err.status === 402)
      return new QuizError("This OpenRouter key has no credit left for that model.", 402);
    return new QuizError(err.message || "OpenRouter request failed.", err.status ?? 502);
  }
  return new QuizError("Couldn't reach OpenRouter. Check your connection and try again.", 502);
}

export async function generateQuiz(opts: {
  provider: QuizProvider;
  apiKey: string;
  text: string;
  count: number;
}): Promise<GeneratedQuestion[]> {
  const questions =
    opts.provider === "anthropic"
      ? await withAnthropic(opts.apiKey, opts.text, opts.count)
      : opts.provider === "openrouter"
        ? await withOpenRouter(opts.apiKey, opts.text, opts.count)
        : await withOpenAI(opts.apiKey, opts.text, opts.count);

  if (questions.length === 0) {
    throw new QuizError(
      "The AI couldn't make usable questions from this deck. Try one with more text, or add questions manually.",
      422,
    );
  }
  return questions;
}

// Walk a Google Slides presentation and pull out its readable text, slide by
// slide. Mirrors the shape returned by the Slides REST API.
export function extractSlidesText(presentation: unknown): string {
  const slides =
    presentation && typeof presentation === "object" && Array.isArray((presentation as any).slides)
      ? (presentation as any).slides
      : [];

  const parts: string[] = [];
  for (const slide of slides) {
    const elements = Array.isArray(slide?.pageElements) ? slide.pageElements : [];
    const lines: string[] = [];
    for (const el of elements) {
      const textElements = el?.shape?.text?.textElements;
      if (!Array.isArray(textElements)) continue;
      let line = "";
      for (const te of textElements) {
        const content = te?.textRun?.content;
        if (typeof content === "string") line += content;
      }
      const trimmed = line.trim();
      if (trimmed) lines.push(trimmed);
    }
    if (lines.length) parts.push(lines.join("\n"));
  }
  return parts.join("\n\n");
}
