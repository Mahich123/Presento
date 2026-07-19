import { nanoid } from "nanoid";
import { DEFAULT_POLL_DURATION_MS } from "./pollTypes";

// A question as the host drafts it, before it's sent to a room. Deliberately
// mirrors the create_poll payload so asking one is a straight pass-through.
export interface DraftQuestion {
  id: string;
  question: string;
  options: string[];
  correctIndex: number | null;
  durationMs: number | null;
}

export interface QuestionSet {
  id: string;
  title: string;
  questions: DraftQuestion[];
  updatedAt: number;
}

// Sets live in the host's browser only — there's no server-side question bank yet.
// Anything read from here is user-editable and may be stale or malformed.
const STORAGE_KEY = "presento.questionSets.v1";

export const emptyQuestion = (): DraftQuestion => ({
  id: nanoid(8),
  question: "",
  options: ["", ""],
  correctIndex: null,
  durationMs: DEFAULT_POLL_DURATION_MS,
});

export const emptySet = (): QuestionSet => ({
  id: nanoid(8),
  title: "",
  questions: [emptyQuestion()],
  updatedAt: Date.now(),
});

/**
 * A question is ready once it has text, at least two real answers, and a correct
 * one marked — set questions are comprehension checks, so the answer is required.
 */
export const isQuestionReady = (q: DraftQuestion) =>
  q.question.trim().length > 0 &&
  q.options.filter((o) => o.trim()).length >= 2 &&
  q.correctIndex !== null &&
  !!q.options[q.correctIndex]?.trim();

export const readySetQuestions = (set: QuestionSet) => set.questions.filter(isQuestionReady);

export interface AskableQuestion {
  question: string;
  options: string[];
  correctIndex: number | null;
  durationMs: number | null;
}

/**
 * Compact a draft to its non-blank answers and remap the correct-answer index
 * onto the compacted list — dropping blanks would otherwise shift the index and
 * mark the wrong answer correct.
 */
export const toAskable = (q: DraftQuestion): AskableQuestion => {
  const options: string[] = [];
  let correctIndex: number | null = null;
  q.options.forEach((opt, i) => {
    const text = opt.trim();
    if (!text) return;
    if (q.correctIndex === i) correctIndex = options.length;
    options.push(text);
  });
  return { question: q.question.trim(), options, correctIndex, durationMs: q.durationMs };
};

function isDraftQuestion(value: unknown): value is DraftQuestion {
  if (!value || typeof value !== "object") return false;
  const q = value as Record<string, unknown>;
  return (
    typeof q.id === "string" &&
    typeof q.question === "string" &&
    Array.isArray(q.options) &&
    q.options.every((o) => typeof o === "string")
  );
}

export function loadSets(): QuestionSet[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // Hand-editable storage — drop anything that doesn't look like a set rather
    // than letting it crash the page on load.
    return parsed
      .filter(
        (s): s is QuestionSet =>
          !!s &&
          typeof s === "object" &&
          typeof s.id === "string" &&
          typeof s.title === "string" &&
          Array.isArray(s.questions),
      )
      .map((s) => ({
        id: s.id,
        title: s.title,
        updatedAt: typeof s.updatedAt === "number" ? s.updatedAt : 0,
        questions: s.questions.filter(isDraftQuestion).map((q) => ({
          id: q.id,
          question: q.question,
          options: q.options,
          correctIndex: typeof q.correctIndex === "number" ? q.correctIndex : null,
          durationMs: typeof q.durationMs === "number" ? q.durationMs : null,
        })),
      }))
      .sort((a, b) => b.updatedAt - a.updatedAt);
  } catch (error) {
    console.error("Failed to read question sets:", error);
    return [];
  }
}

export function saveSet(set: QuestionSet): QuestionSet[] {
  const next = loadSets().filter((s) => s.id !== set.id);
  next.unshift({ ...set, updatedAt: Date.now() });
  persist(next);
  return next;
}

export function deleteSet(id: string): QuestionSet[] {
  const next = loadSets().filter((s) => s.id !== id);
  persist(next);
  return next;
}

function persist(sets: QuestionSet[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sets));
  } catch (error) {
    // Quota or private-mode failures shouldn't take the editor down.
    console.error("Failed to save question sets:", error);
  }
}

// Remembers which set the host loaded into the current room, so we can offer to
// keep or delete it when the room closes. Ephemeral room state, not a set itself.
const LOADED_SET_KEY = "presento.loadedSetId";

export function markSetLoaded(id: string) {
  try {
    localStorage.setItem(LOADED_SET_KEY, id);
  } catch (error) {
    console.error("Failed to record loaded set:", error);
  }
}

export function clearLoadedSet() {
  localStorage.removeItem(LOADED_SET_KEY);
}

/** The set loaded into the room this session, if it still exists. */
export function getLoadedSet(): QuestionSet | null {
  const id = localStorage.getItem(LOADED_SET_KEY);
  if (!id) return null;
  return loadSets().find((s) => s.id === id) ?? null;
}
