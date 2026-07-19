import { useEffect, useRef, useState } from "react";
import {
  ChevronDown,
  ChevronLeft,
  Check,
  ExternalLink,
  GripVertical,
  Play,
  Plus,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { POLL_DURATIONS } from "../utils/pollTypes";
import {
  loadAIConfig,
  saveAIConfig,
  providerList,
  PROVIDER_KEY_HELP,
  PROVIDER_KEY_PREFIX,
  PROVIDER_LABELS,
  type AIConfig,
  type AIProvider,
} from "../utils/aiConfig";
import {
  deleteSet,
  emptyQuestion,
  emptySet,
  isQuestionReady,
  loadSets,
  readySetQuestions,
  saveSet,
  type DraftQuestion,
  type QuestionSet,
} from "../utils/questionSets";

const BRAND = "#BB8856";
const MIN_OPTIONS = 2;
const MAX_OPTIONS = 6;
const QUESTION_COUNTS = [3, 5, 10];

interface QuestionSetManagerProps {
  // When present, each set gets a "Load into room" action (used inside a room).
  onLoadSet?: (set: QuestionSet) => void;
  // When present, a close button appears (used inside a modal).
  onClose?: () => void;
  // When present, questions can be drafted from the deck the host is presenting.
  onGenerate?: (config: AIConfig, count: number) => Promise<DraftQuestion[]>;
  // False while the deck is still loading, so we don't offer a generate that fails.
  canGenerate?: boolean;
  // "slides" or "PDF" — used in the copy so it matches what the host is showing.
  deckLabel?: string;
}

function QuestionEditor({
  draft,
  index,
  onChange,
  onRemove,
  canRemove,
}: {
  draft: DraftQuestion;
  index: number;
  onChange: (next: DraftQuestion) => void;
  onRemove: () => void;
  canRemove: boolean;
}) {
  const [open, setOpen] = useState(!draft.question.trim());
  const ready = isQuestionReady(draft);

  const setOption = (i: number, value: string) =>
    onChange({ ...draft, options: draft.options.map((o, oi) => (oi === i ? value : o)) });

  const removeOption = (i: number) => {
    // Keep the correct-answer marker on the same option after a removal.
    const nextCorrect =
      draft.correctIndex === null || draft.correctIndex === i
        ? null
        : draft.correctIndex > i
          ? draft.correctIndex - 1
          : draft.correctIndex;
    onChange({
      ...draft,
      options: draft.options.filter((_, oi) => oi !== i),
      correctIndex: nextCorrect,
    });
  };

  return (
    <div className="rounded-xl border border-base-300 bg-base-100 overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2.5">
        <GripVertical className="size-4 text-base-content/25 shrink-0" />
        <span className="shrink-0 w-6 h-6 rounded-full bg-base-200 text-xs font-semibold flex items-center justify-center">
          {index + 1}
        </span>
        <button onClick={() => setOpen((o) => !o)} className="flex-1 min-w-0 text-left">
          <span className={`text-sm truncate block ${ready ? "" : "text-base-content/40 italic"}`}>
            {draft.question.trim() || "Untitled question"}
          </span>
        </button>
        {/* A quiet status dot instead of a loud "incomplete" pill — informs
            without nagging while the host is still filling the question in. */}
        <span
          aria-label={ready ? "Ready" : "Not finished yet"}
          className={`shrink-0 size-2 rounded-full ${ready ? "bg-success" : "bg-base-content/20"}`}
        />
        {canRemove && (
          <button
            onClick={onRemove}
            aria-label={`Delete question ${index + 1}`}
            className="p-1 shrink-0 text-base-content/30 hover:text-error transition-colors"
          >
            <Trash2 className="size-4" />
          </button>
        )}
        <button
          onClick={() => setOpen((o) => !o)}
          aria-label={open ? "Collapse" : "Expand"}
          className="p-1 shrink-0 text-base-content/40"
        >
          <ChevronDown className={`size-4 transition-transform ${open ? "rotate-180" : ""}`} />
        </button>
      </div>

      {open && (
        <div className="px-3.5 pb-4 pt-4 space-y-4 border-t border-base-200 bg-base-200/25">
          {/* Question */}
          <div className="space-y-1.5">
            <label className="text-[11px] font-semibold uppercase tracking-wider text-base-content/45">
              Question
            </label>
            <input
              type="text"
              value={draft.question}
              onChange={(e) => onChange({ ...draft, question: e.target.value })}
              maxLength={200}
              placeholder="What do you want to ask?"
              className="w-full bg-base-100 rounded-lg border border-base-300 px-3 py-2.5 text-sm font-medium outline-none transition-colors focus:border-(--brand)"
              style={{ ["--brand" as string]: BRAND }}
            />
          </div>

          {/* Answers */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-[11px] font-semibold uppercase tracking-wider text-base-content/45">
                Answers
              </label>
              <span className="text-[11px] text-base-content/40">
                tap the check to mark the correct one
              </span>
            </div>

            {draft.options.map((opt, i) => {
              const isCorrect = draft.correctIndex === i;
              const letter = String.fromCharCode(65 + i); // A, B, C…
              return (
                <div
                  key={i}
                  className={`flex items-center gap-2 rounded-lg border pl-2 pr-1 py-1 transition-colors ${
                    isCorrect ? "border-success bg-success/10" : "border-base-300 bg-base-100"
                  }`}
                >
                  <span
                    className={`shrink-0 w-6 h-6 rounded-md text-xs font-bold flex items-center justify-center transition-colors ${
                      isCorrect ? "bg-success text-white" : "bg-base-200 text-base-content/50"
                    }`}
                  >
                    {letter}
                  </span>
                  <input
                    type="text"
                    value={opt}
                    onChange={(e) => setOption(i, e.target.value)}
                    maxLength={100}
                    placeholder={`Answer ${letter}`}
                    className="flex-1 min-w-0 bg-transparent text-sm outline-none py-1.5"
                  />
                  {/* Ticking an answer marks it correct — no separate quiz toggle. */}
                  <button
                    onClick={() => onChange({ ...draft, correctIndex: isCorrect ? null : i })}
                    aria-label={isCorrect ? "Unmark as correct" : "Mark as correct"}
                    aria-pressed={isCorrect}
                    className={`shrink-0 w-6 h-6 rounded-full border-2 flex items-center justify-center transition-colors ${
                      isCorrect
                        ? "bg-success border-success"
                        : "border-base-300 hover:border-success/60"
                    }`}
                  >
                    {isCorrect && <Check className="size-3.5 text-white" strokeWidth={3} />}
                  </button>
                  {draft.options.length > MIN_OPTIONS && (
                    <button
                      onClick={() => removeOption(i)}
                      aria-label={`Remove answer ${letter}`}
                      className="p-1 shrink-0 text-base-content/30 hover:text-error transition-colors"
                    >
                      <Trash2 className="size-4" />
                    </button>
                  )}
                </div>
              );
            })}

            {/* Correct answer is mandatory, but don't nag on a blank question —
                only prompt once the host has actually typed an answer to mark. */}
            {draft.correctIndex === null && draft.options.some((o) => o.trim()) && (
              <p className="text-[11px] text-base-content/50 pl-1">
                Mark which answer is correct.
              </p>
            )}

            {draft.options.length < MAX_OPTIONS && (
              <button
                onClick={() => onChange({ ...draft, options: [...draft.options, ""] })}
                className="flex items-center justify-center gap-1 w-full rounded-lg border border-dashed border-base-300 py-2 text-xs font-medium text-base-content/55 hover:text-base-content hover:border-base-content/30 transition-colors"
              >
                <Plus className="size-3.5" />
                Add answer
              </button>
            )}
          </div>

          {/* Time */}
          <div className="flex items-center justify-between gap-2 pt-1">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-base-content/45">
              Time to answer
            </span>
            {/* Segmented control — one calm group instead of loose buttons. */}
            <div className="inline-flex rounded-lg border border-base-300 bg-base-100 overflow-hidden">
              {POLL_DURATIONS.map((d) => (
                <button
                  key={d.label}
                  onClick={() => onChange({ ...draft, durationMs: d.ms })}
                  className={`px-2.5 py-1 text-[11px] font-medium transition-colors border-l border-base-300 first:border-l-0 ${
                    draft.durationMs === d.ms
                      ? "text-white"
                      : "text-base-content/60 hover:bg-base-200"
                  }`}
                  style={draft.durationMs === d.ms ? { background: BRAND } : undefined}
                >
                  {d.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Drafts questions from the deck using the host's own AI account. The key is
 * kept in this browser and sent to our server only to make the one call.
 */
function GeneratePanel({
  onGenerate,
  onDrafted,
  onCancel,
  deckLabel,
}: {
  onGenerate: (config: AIConfig, count: number, signal: AbortSignal) => Promise<DraftQuestion[]>;
  onDrafted: (questions: DraftQuestion[]) => void;
  onCancel: () => void;
  deckLabel: string;
}) {
  const [saved] = useState(() => loadAIConfig());
  // Default to the free option — it's the only one that works without a card.
  const [provider, setProvider] = useState<AIProvider>(saved?.provider ?? "openrouter");
  const [apiKey, setApiKey] = useState(saved?.apiKey ?? "");
  const [count, setCount] = useState(5);
  const [busy, setBusy] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const cancelledRef = useRef(false);

  const help = PROVIDER_KEY_HELP[provider];
  const isFree = provider === "openrouter";

  // A ticking counter is the cheapest proof the request is still alive — a bare
  // spinner is indistinguishable from a hang.
  useEffect(() => {
    if (!busy) return;
    setElapsed(0);
    const id = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(id);
  }, [busy]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const run = async () => {
    const key = apiKey.trim();
    if (!key || busy) return;

    const controller = new AbortController();
    abortRef.current = controller;
    cancelledRef.current = false;
    // The server gives up at ~75s; stop a little after that so a dropped
    // connection can't leave the host spinning forever.
    const timeoutId = setTimeout(() => controller.abort(), 90_000);

    setBusy(true);
    setError(null);
    try {
      const questions = await onGenerate({ provider, apiKey: key }, count, controller.signal);
      // Only remember a key that actually worked.
      saveAIConfig({ provider, apiKey: key });
      onDrafted(questions);
    } catch (err) {
      if (cancelledRef.current) {
        setError(null);
      } else if (err instanceof Error && err.name === "AbortError") {
        setError(
          isFree
            ? "That took too long — free models are busy right now. Try again, or use a paid key."
            : "That took too long. Try again.",
        );
      } else {
        setError(err instanceof Error ? err.message : "Couldn't generate questions.");
      }
    } finally {
      clearTimeout(timeoutId);
      abortRef.current = null;
      setBusy(false);
    }
  };

  const cancel = () => {
    cancelledRef.current = true;
    abortRef.current?.abort();
  };

  // Escalating reassurance — says something different as time passes, so it
  // never looks frozen.
  const status =
    elapsed < 6
      ? `Reading your ${deckLabel}…`
      : elapsed < 20
        ? "Writing questions…"
        : elapsed < 45
          ? isFree
            ? "Still going — free models are slower when busy."
            : "Still going…"
          : "Taking longer than usual. It'll stop on its own if it can't finish.";

  return (
    <div className="rounded-xl border border-base-300 bg-base-100 p-4 mb-4 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold flex items-center gap-1.5">
            <Sparkles className="size-4" style={{ color: BRAND }} />
            Draft questions from your {deckLabel}
          </h3>
          <p className="text-xs text-base-content/50 mt-0.5">
            You'll review and edit everything before it's saved.
          </p>
        </div>
        <button
          onClick={onCancel}
          className="btn btn-ghost btn-xs btn-circle shrink-0"
          aria-label="Cancel"
        >
          <X className="size-4" />
        </button>
      </div>

      {/* Provider */}
      <div className="space-y-1.5">
        <label className="text-[11px] font-semibold uppercase tracking-wider text-base-content/45">
          Generate using
        </label>
        <div className="inline-flex rounded-lg border border-base-300 overflow-hidden">
          {providerList().map((p) => (
            <button
              key={p}
              onClick={() => setProvider(p)}
              className={`px-4 py-1.5 text-xs font-medium transition-colors border-l border-base-300 first:border-l-0 ${
                provider === p ? "text-white" : "text-base-content/60 hover:bg-base-200"
              }`}
              style={provider === p ? { background: BRAND } : undefined}
            >
              {PROVIDER_LABELS[p]}
            </button>
          ))}
        </div>
      </div>

      {/* Key */}
      <div className="space-y-1.5">
        <label className="text-[11px] font-semibold uppercase tracking-wider text-base-content/45">
          API key
        </label>
        <input
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder={PROVIDER_KEY_PREFIX[provider]}
          autoComplete="off"
          spellCheck={false}
          className="w-full bg-base-100 rounded-lg border border-base-300 px-3 py-2.5 text-sm outline-none transition-colors focus:border-(--brand)"
          style={{ ["--brand" as string]: BRAND }}
        />
        <p className="text-[11px] text-base-content/45">{help.hint}</p>
        <a
          href={help.url}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-[11px] font-medium hover:underline"
          style={{ color: BRAND }}
        >
          {help.label}
          <ExternalLink className="size-3" />
        </a>
      </div>

      {/* Count */}
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-base-content/45">
          How many
        </span>
        <div className="inline-flex rounded-lg border border-base-300 overflow-hidden">
          {QUESTION_COUNTS.map((n) => (
            <button
              key={n}
              onClick={() => setCount(n)}
              className={`px-3 py-1 text-[11px] font-medium transition-colors border-l border-base-300 first:border-l-0 ${
                count === n ? "text-white" : "text-base-content/60 hover:bg-base-200"
              }`}
              style={count === n ? { background: BRAND } : undefined}
            >
              {n}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <p className="text-xs text-error bg-error/10 border border-error/20 rounded-lg px-3 py-2">
          {error}
        </p>
      )}

      {/* Free models are hosted by third parties that may log or train on what
          they're sent — hosts should know before sending their slides. */}
      {provider === "openrouter" && (
        <p className="text-[11px] text-base-content/45 bg-base-200/60 rounded-lg px-3 py-2">
          Free models are run by third parties and may log or train on what they receive.
          Use a paid key for sensitive material.
        </p>
      )}

      {busy ? (
        <div className="rounded-lg border border-base-300 bg-base-200/40 px-3 py-3 space-y-2">
          <div className="flex items-center gap-2.5">
            <span className="loading loading-spinner loading-sm" style={{ color: BRAND }} />
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium">{status}</p>
              <p className="text-[11px] text-base-content/45 tabular-nums">
                {elapsed}s elapsed
                {isFree && elapsed < 20 ? " — this usually takes 10–40s" : ""}
              </p>
            </div>
            <button onClick={cancel} className="btn btn-ghost btn-xs shrink-0">
              Cancel
            </button>
          </div>
          {/* Indeterminate bar — reinforces "working", never fakes a percentage
              we don't actually know. */}
          <progress className="progress w-full h-1" />
        </div>
      ) : (
        <div className="flex items-center justify-between gap-3 pt-1">
          <p className="text-[11px] text-base-content/40">Your key stays in this browser.</p>
          <button
            onClick={run}
            disabled={!apiKey.trim()}
            className="btn btn-sm text-white border-0 disabled:opacity-40"
            style={{ background: BRAND }}
          >
            <Sparkles className="size-4" />
            Generate
          </button>
        </div>
      )}
    </div>
  );
}

export default function QuestionSetManager({
  onLoadSet,
  onClose,
  onGenerate,
  canGenerate = false,
  deckLabel = "deck",
}: QuestionSetManagerProps) {
  const [sets, setSets] = useState<QuestionSet[]>([]);
  const [editing, setEditing] = useState<QuestionSet | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);

  useEffect(() => {
    setSets(loadSets());
  }, []);

  const commit = (set: QuestionSet) => {
    setSets(saveSet(set));
    setEditing(null);
  };

  const patchQuestion = (id: string, next: DraftQuestion) =>
    setEditing((prev) =>
      prev ? { ...prev, questions: prev.questions.map((q) => (q.id === id ? next : q)) } : prev,
    );

  return (
    <>
      {onClose && (
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-bold text-lg">Question sets</h2>
          <button onClick={onClose} className="btn btn-ghost btn-sm btn-circle" aria-label="Close">
            <X className="size-5" />
          </button>
        </div>
      )}

      {editing ? (
        <>
          <div className="flex items-center gap-2 mb-4">
            <button
              onClick={() => setEditing(null)}
              className="btn btn-ghost btn-sm btn-circle"
              aria-label="Back to sets"
            >
              <ChevronLeft className="size-5" />
            </button>
            <input
              type="text"
              value={editing.title}
              onChange={(e) => setEditing({ ...editing, title: e.target.value })}
              maxLength={80}
              placeholder="Set name — e.g. Week 3 revision"
              className="flex-1 input input-bordered input-sm font-semibold"
            />
          </div>

          <div className="space-y-2">
            {editing.questions.map((q, i) => (
              <QuestionEditor
                key={q.id}
                draft={q}
                index={i}
                canRemove={editing.questions.length > 1}
                onChange={(next) => patchQuestion(q.id, next)}
                onRemove={() =>
                  setEditing({ ...editing, questions: editing.questions.filter((x) => x.id !== q.id) })
                }
              />
            ))}
          </div>

          <button
            onClick={() =>
              setEditing({ ...editing, questions: [...editing.questions, emptyQuestion()] })
            }
            className="btn btn-sm btn-outline w-full mt-3"
          >
            <Plus className="size-4" />
            Add question
          </button>

          <div className="flex items-center justify-between gap-3 mt-5 pt-4 border-t border-base-300">
            <p className="text-xs text-base-content/50">
              {readySetQuestions(editing).length} of {editing.questions.length} ready to ask
            </p>
            <button
              onClick={() => commit(editing)}
              disabled={!editing.title.trim() || readySetQuestions(editing).length === 0}
              className="btn btn-sm text-white border-0 disabled:opacity-40"
              style={{ background: BRAND }}
            >
              Save set
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="flex items-center justify-between gap-3 mb-4">
            <div>
              {!onClose && <h1 className="text-xl font-bold">Question sets</h1>}
              <p className="text-xs text-base-content/50 mt-0.5">
                Prepare questions, then load a set and ask them one at a time.
                {onGenerate && canGenerate && ` Or let AI draft them from the ${deckLabel} you're presenting.`}
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {/* Only offered in-room, once the deck is actually loaded. */}
              {onGenerate && canGenerate && !generating && (
                <button
                  onClick={() => setGenerating(true)}
                  title={`Use AI to write questions from the ${deckLabel} you're presenting`}
                  className="btn btn-sm btn-outline"
                  style={{ borderColor: BRAND, color: BRAND }}
                >
                  <Sparkles className="size-4" />
                  Write with AI
                </button>
              )}
              <button
                onClick={() => setEditing(emptySet())}
                className="btn btn-sm text-white border-0"
                style={{ background: BRAND }}
              >
                <Plus className="size-4" />
                New set
              </button>
            </div>
          </div>

          {onGenerate && generating && (
            <GeneratePanel
              onGenerate={onGenerate}
              deckLabel={deckLabel}
              onCancel={() => setGenerating(false)}
              onDrafted={(questions) => {
                setGenerating(false);
                // Land in the editor unsaved — the host reviews before keeping it.
                setEditing({ ...emptySet(), title: "AI quiz", questions });
              }}
            />
          )}

          {/* localStorage-only for now — worth saying so before someone loses a set. */}
          <div className="text-[11px] text-base-content/40 mb-4">
            Sets are saved in this browser only. Clearing site data will remove them.
          </div>

          {sets.length === 0 ? (
            <div className="text-center py-16 rounded-xl border border-dashed border-base-300">
              <p className="text-sm text-base-content/50">No sets yet</p>
              <p className="text-xs text-base-content/40 mt-1">
                Create one to ask several questions in a session.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {sets.map((set) => {
                const ready = readySetQuestions(set).length;
                return (
                  <div
                    key={set.id}
                    className="flex items-center gap-2 p-3 rounded-xl border border-base-300 bg-base-100"
                  >
                    <button onClick={() => setEditing(set)} className="flex-1 min-w-0 text-left">
                      <p className="font-medium text-sm truncate">{set.title || "Untitled set"}</p>
                      <p className="text-xs text-base-content/50 mt-0.5">
                        {ready} {ready === 1 ? "question" : "questions"}
                      </p>
                    </button>
                    {/* Load only offered in-room, and only when the set has askable questions. */}
                    {onLoadSet && ready > 0 && (
                      <button
                        onClick={() => onLoadSet(set)}
                        className="btn btn-sm text-white border-0 shrink-0"
                        style={{ background: BRAND }}
                      >
                        <Play className="size-3.5" />
                        Load
                      </button>
                    )}
                    <button
                      onClick={() => setConfirmDelete(set.id)}
                      aria-label={`Delete ${set.title || "set"}`}
                      className="p-2 shrink-0 text-base-content/30 hover:text-error transition-colors"
                    >
                      <Trash2 className="size-4" />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      <dialog className={`modal ${confirmDelete ? "modal-open" : ""}`}>
        <div className="modal-box w-full max-w-md mx-4 bg-base-100">
          <h3 className="font-bold text-lg">Delete this set?</h3>
          <p className="py-3 text-sm text-base-content/70">
            This can't be undone — the set only exists in this browser.
          </p>
          <div className="modal-action">
            <button className="btn" onClick={() => setConfirmDelete(null)}>
              Cancel
            </button>
            <button
              className="btn btn-error"
              onClick={() => {
                if (confirmDelete) setSets(deleteSet(confirmDelete));
                setConfirmDelete(null);
              }}
            >
              Delete
            </button>
          </div>
        </div>
      </dialog>
    </>
  );
}
