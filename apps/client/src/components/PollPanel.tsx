import { useState } from "react";
import { Check, HelpCircle, ListChecks, Plus, Radio, Trash2 } from "lucide-react";
import {
  DEFAULT_POLL_DURATION_MS,
  POLL_DURATIONS,
  type PollState,
} from "../utils/pollTypes";

interface PollPanelProps {
  state: PollState;
  isHost: boolean;
  onCreate: (
    question: string,
    options: string[],
    correctIndex: number | null,
    durationMs: number | null,
  ) => void;
  onManageSets: () => void;
  onAskNext: () => void;
  onClearQueue: () => void;
}

const MIN_OPTIONS = 2;
const MAX_OPTIONS = 6;
const BRAND = "#BB8856";

function PollForm({
  onCreate,
  onCancel,
}: {
  onCreate: PollPanelProps["onCreate"];
  onCancel: () => void;
}) {
  const [question, setQuestion] = useState("");
  const [options, setOptions] = useState<string[]>(["", ""]);
  const [correctIndex, setCorrectIndex] = useState<number | null>(null);
  const [durationMs, setDurationMs] = useState<number | null>(DEFAULT_POLL_DURATION_MS);

  const filledCount = options.filter((o) => o.trim()).length;
  const canSubmit = question.trim().length > 0 && filledCount >= MIN_OPTIONS;

  const removeOption = (index: number) => {
    setOptions((prev) => prev.filter((_, i) => i !== index));
    // Keep the correct-answer marker pinned to the same option after a removal.
    setCorrectIndex((prev) => {
      if (prev === null || prev === index) return null;
      return prev > index ? prev - 1 : prev;
    });
  };

  const handleSubmit = () => {
    // Blank options are dropped, so the correct-answer index has to be remapped
    // onto the compacted list before it goes to the server.
    const kept: string[] = [];
    let mappedCorrect: number | null = null;
    options.forEach((opt, i) => {
      const text = opt.trim();
      if (!text) return;
      if (correctIndex === i) mappedCorrect = kept.length;
      kept.push(text);
    });
    if (!question.trim() || kept.length < MIN_OPTIONS) return;
    onCreate(question.trim(), kept, mappedCorrect, durationMs);
  };

  return (
    <div className="space-y-4">
      <input
        type="text"
        value={question}
        onChange={(e) => setQuestion(e.target.value)}
        maxLength={200}
        autoFocus
        placeholder="Ask a question…"
        className="w-full input input-bordered input-sm bg-white text-gray-900 placeholder-gray-400"
      />

      <div>
        <div className="space-y-2">
          {options.map((opt, i) => (
            <div key={i} className="flex items-center gap-1.5">
              <button
                onClick={() => setCorrectIndex((prev) => (prev === i ? null : i))}
                aria-label={correctIndex === i ? "Unmark as correct" : "Mark as correct"}
                aria-pressed={correctIndex === i}
                className={`shrink-0 w-5 h-5 rounded-full border-2 flex items-center justify-center transition-colors ${
                  correctIndex === i
                    ? "bg-green-500 border-green-500"
                    : "border-gray-300 hover:border-green-400"
                }`}
              >
                {correctIndex === i && <Check className="size-3 text-white" strokeWidth={3} />}
              </button>
              <input
                type="text"
                value={opt}
                onChange={(e) =>
                  setOptions((prev) => prev.map((o, oi) => (oi === i ? e.target.value : o)))
                }
                maxLength={100}
                placeholder={`Answer ${i + 1}`}
                className="flex-1 min-w-0 input input-bordered input-sm bg-white text-gray-900 placeholder-gray-400"
              />
              {options.length > MIN_OPTIONS && (
                <button
                  onClick={() => removeOption(i)}
                  aria-label={`Remove answer ${i + 1}`}
                  className="p-1 shrink-0 text-gray-400 hover:text-red-500 transition-colors"
                >
                  <Trash2 className="size-4" />
                </button>
              )}
            </div>
          ))}
        </div>

        <div className="flex items-center justify-between mt-2">
          {options.length < MAX_OPTIONS ? (
            <button
              onClick={() => setOptions((prev) => [...prev, ""])}
              className="flex items-center gap-1 text-xs font-medium text-gray-500 hover:text-gray-700"
            >
              <Plus className="size-3.5" />
              Add answer
            </button>
          ) : (
            <span />
          )}
          <span className="text-[11px] text-gray-400">Tick the right answer (optional)</span>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <span className="text-xs text-gray-500 shrink-0">Time</span>
        <div className="flex gap-1 flex-1">
          {POLL_DURATIONS.map((d) => (
            <button
              key={d.label}
              onClick={() => setDurationMs(d.ms)}
              className={`flex-1 px-1.5 py-1 rounded-md text-[11px] font-medium border transition-colors ${
                durationMs === d.ms ? "text-white" : "border-gray-200 text-gray-500 hover:bg-gray-50"
              }`}
              style={durationMs === d.ms ? { background: BRAND, borderColor: BRAND } : undefined}
            >
              {d.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex gap-2">
        <button onClick={onCancel} className="btn btn-sm btn-ghost flex-1 text-gray-600">
          Cancel
        </button>
        <button
          onClick={handleSubmit}
          disabled={!canSubmit}
          className="btn btn-sm flex-1 text-white border-0 hover:opacity-90 disabled:opacity-40"
          style={{ background: BRAND }}
        >
          Ask
        </button>
      </div>
    </div>
  );
}

export default function PollPanel({
  state,
  isHost,
  onCreate,
  onManageSets,
  onAskNext,
  onClearQueue,
}: PollPanelProps) {
  const [mode, setMode] = useState<"idle" | "compose">("idle");
  const { poll, queueTotal, queueAsked, queuePreview } = state;
  const queueDone = queueTotal > 0 && queueAsked >= queueTotal;

  if (isHost && mode === "compose") {
    return (
      <div className="flex-1 overflow-y-auto p-3 sm:p-4 min-h-0">
        <PollForm
          onCreate={(q, opts, correct, duration) => {
            onCreate(q, opts, correct, duration);
            setMode("idle");
          }}
          onCancel={() => setMode("idle")}
        />
      </div>
    );
  }

  return (
    <>
      <div className="flex-1 overflow-y-auto p-3 sm:p-4 min-h-0 space-y-3">
        {poll && (
          // The question itself is on the slide — this tab only reports that.
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-gray-50 border border-gray-200">
            <Radio className="size-4 shrink-0 animate-pulse" style={{ color: BRAND }} />
            <p className="text-xs text-gray-600 font-medium">
              {poll.status === "open" ? "Question is live on the slide" : "Results are on the slide"}
            </p>
          </div>
        )}

        {!poll && queueTotal === 0 && (
          <div className="flex flex-col items-center justify-center gap-2 py-10 text-center">
            <HelpCircle className="size-8 text-gray-300" />
            <p className="text-sm text-gray-400">No question yet</p>
            {!isHost && <p className="text-xs text-gray-400">The host hasn't asked one yet.</p>}
          </div>
        )}

        {/* Queue progress — host only; viewers get an empty preview from the server. */}
        {isHost && queueTotal > 0 && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500 flex items-center gap-1.5">
                <ListChecks className="size-3.5" />
                Set
              </h4>
              <span className="text-xs text-gray-400">
                {queueAsked} of {queueTotal} asked
              </span>
            </div>

            <div className="space-y-1">
              {queuePreview.map((q, i) => (
                <div
                  key={i}
                  className={`flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs ${
                    q.asked ? "text-gray-400" : "text-gray-700 bg-gray-50"
                  }`}
                >
                  <span
                    className={`shrink-0 w-4 h-4 rounded-full text-[9px] font-bold flex items-center justify-center ${
                      q.asked ? "bg-gray-200 text-gray-400" : "text-white"
                    }`}
                    style={!q.asked ? { background: BRAND } : undefined}
                  >
                    {q.asked ? <Check className="size-2.5" strokeWidth={4} /> : i + 1}
                  </span>
                  <span className={`flex-1 truncate ${q.asked ? "line-through" : ""}`}>
                    {q.question}
                  </span>
                </div>
              ))}
            </div>

            <button
              onClick={onClearQueue}
              className="text-xs text-gray-400 hover:text-red-500 transition-colors"
            >
              Clear set
            </button>
          </div>
        )}
      </div>

      {isHost && (
        <div className="p-2 sm:p-3 border-t border-gray-200 shrink-0 space-y-2">
          {queueTotal > 0 && !queueDone && (
            <button
              onClick={onAskNext}
              className="btn btn-sm w-full text-white border-0 hover:opacity-90"
              style={{ background: BRAND }}
            >
              {queueAsked === 0 ? "Ask first question" : `Ask next (${queueAsked + 1} of ${queueTotal})`}
            </button>
          )}

          {queueDone && (
            <p className="text-center text-xs text-gray-400 py-1">All questions asked</p>
          )}

          {!poll && (
            <div className="flex gap-2">
              <button
                onClick={() => setMode("compose")}
                className="btn btn-sm flex-1 btn-outline text-gray-700"
              >
                <Plus className="size-4" />
                Ask one
              </button>
              <button
                onClick={onManageSets}
                className="btn btn-sm flex-1 btn-outline text-gray-700"
              >
                <ListChecks className="size-4" />
                Question sets
              </button>
            </div>
          )}
        </div>
      )}
    </>
  );
}
