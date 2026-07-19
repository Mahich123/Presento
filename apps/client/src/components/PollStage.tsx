import { useRef } from "react";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import { Check } from "lucide-react";
import { prefersReducedMotion, type PollState } from "../utils/pollTypes";

interface PollStageProps {
  state: PollState;
  isHost: boolean;
  isMuted: boolean;
  onVote: (optionId: string) => void;
  onClosePoll: () => void;
  onClearPoll: () => void;
  onAskNext: () => void;
}

const BRAND = "#BB8856";

function formatClock(ms: number) {
  const total = Math.ceil(Math.max(0, ms) / 1000);
  return total >= 60 ? `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}` : `${total}s`;
}

export default function PollStage({
  state,
  isHost,
  isMuted,
  onVote,
  onClosePoll,
  onClearPoll,
  onAskNext,
}: PollStageProps) {
  const root = useRef<HTMLDivElement | null>(null);
  const timerBar = useRef<HTMLDivElement | null>(null);
  const { poll, counts, countsVisible, totalVotes, eligibleVoters, myVote, remainingMs } = state;

  const isClosed = poll?.status === "closed";
  const hasAnswered = myVote !== null;

  useGSAP(
    () => {
      if (prefersReducedMotion()) return;
      gsap.from(".poll-card", { y: 12, opacity: 0, duration: 0.35, ease: "power2.out" });
      gsap.from(".poll-option", {
        y: 8,
        opacity: 0,
        duration: 0.3,
        stagger: 0.05,
        delay: 0.08,
        ease: "power2.out",
      });
    },
    { scope: root, dependencies: [poll?.id] },
  );

  // Drain the bar between the server's one-second ticks so it reads as continuous.
  useGSAP(
    () => {
      if (!poll?.durationMs || remainingMs === null || isClosed) return;
      const progress = gsap.utils.clamp(0, 1, remainingMs / poll.durationMs);
      gsap.to(timerBar.current, {
        scaleX: progress,
        duration: prefersReducedMotion() ? 0 : 0.95,
        ease: "none",
        overwrite: true,
      });
    },
    { dependencies: [remainingMs, poll?.durationMs, isClosed] },
  );

  useGSAP(
    () => {
      if (!isClosed || prefersReducedMotion()) return;
      gsap.from(".poll-summary", { y: 8, opacity: 0, duration: 0.4, delay: 0.2, ease: "power2.out" });
    },
    { scope: root, dependencies: [isClosed, poll?.id] },
  );

  if (!poll) return null;

  const canAnswer = !isHost && !isClosed && !hasAnswered && !isMuted;
  const denominator = Math.max(eligibleVoters, totalVotes, 1);
  const hasNextInSet = state.queueTotal > 0 && state.queueAsked < state.queueTotal;
  const correctCount = poll.correctOptionId ? (counts[poll.correctOptionId] ?? 0) : 0;

  // The teaching signal: which wrong answer pulled the most people in.
  const mostMissed =
    isClosed && poll.isQuiz
      ? poll.options
          .filter((o) => o.id !== poll.correctOptionId)
          .map((o) => ({ option: o, count: counts[o.id] ?? 0 }))
          .sort((a, b) => b.count - a.count)
          .find((o) => o.count > 0) ?? null
      : null;

  const urgent = remainingMs !== null && remainingMs <= 5000 && !isClosed;

  return (
    <div
      ref={root}
      className="absolute inset-0 z-20 flex items-center justify-center bg-black/70 backdrop-blur-sm p-3 sm:p-6 overflow-y-auto"
    >
      <div className="poll-card w-full max-w-lg bg-white rounded-2xl shadow-2xl overflow-hidden">
        {/* Time remaining drains left to right; absent entirely when there's no limit. */}
        {poll.durationMs && !isClosed && (
          <div className="h-1 w-full bg-gray-100">
            <div
              ref={timerBar}
              className="h-full origin-left"
              style={{ background: urgent ? "#ef4444" : BRAND, transform: "scaleX(1)" }}
            />
          </div>
        )}

        <div className="p-4 sm:p-6 space-y-4">
          <div className="space-y-1.5">
            {/* Position in the set — tells the room how much is left. */}
            {poll.queuePosition !== null && poll.queueTotal !== null && (
              <p className="text-[11px] font-medium uppercase tracking-wide text-gray-400">
                Question {poll.queuePosition} of {poll.queueTotal}
              </p>
            )}
            <div className="flex items-start justify-between gap-3">
              <h2 className="text-base sm:text-xl font-semibold text-gray-900 leading-snug">
                {poll.question}
              </h2>
              {!isClosed && remainingMs !== null && (
                <span
                  className={`shrink-0 text-sm font-semibold tabular-nums ${
                    urgent ? "text-red-500" : "text-gray-400"
                  }`}
                >
                  {formatClock(remainingMs)}
                </span>
              )}
            </div>
          </div>

          <div className="space-y-2">
            {poll.options.map((opt) => {
              const count = counts[opt.id] ?? 0;
              const pct = totalVotes > 0 ? Math.round((count / totalVotes) * 100) : 0;
              const isMine = myVote === opt.id;
              const isCorrect = isClosed && poll.correctOptionId === opt.id;
              const isMostMissed = mostMissed?.option.id === opt.id;

              const border = isCorrect
                ? "border-green-500 bg-green-50"
                : isMostMissed
                  ? "border-amber-300 bg-amber-50"
                  : isMine && !isClosed
                    ? "bg-[#BB8856]/10"
                    : "border-gray-200";

              return (
                <button
                  key={opt.id}
                  onClick={() => canAnswer && onVote(opt.id)}
                  disabled={!canAnswer}
                  className={`poll-option relative w-full overflow-hidden rounded-xl border-2 px-3 sm:px-4 py-2.5 sm:py-3 text-left transition-colors ${border} ${
                    canAnswer ? "cursor-pointer hover:border-[#BB8856] hover:bg-[#BB8856]/5" : "cursor-default"
                  } ${isClosed && !isCorrect && !isMostMissed && poll.isQuiz ? "opacity-60" : ""}`}
                  style={isMine && !isClosed && !isCorrect ? { borderColor: BRAND } : undefined}
                >
                  {/* Tally fill sits behind the label rather than as a separate chart. */}
                  {countsVisible && (
                    <span
                      className="absolute inset-y-0 left-0 transition-[width] duration-500 pointer-events-none"
                      style={{
                        width: `${pct}%`,
                        background: isCorrect
                          ? "rgba(34,197,94,0.16)"
                          : isMostMissed
                            ? "rgba(245,158,11,0.16)"
                            : "rgba(187,136,86,0.14)",
                      }}
                    />
                  )}

                  <span className="relative flex items-center gap-2.5">
                    {isCorrect && (
                      <Check className="size-4 shrink-0 text-green-600" strokeWidth={3} />
                    )}
                    <span
                      className={`flex-1 text-sm sm:text-base ${
                        isCorrect ? "font-semibold text-green-900" : "text-gray-800"
                      }`}
                    >
                      {opt.text}
                    </span>

                    {isMine && (
                      <span className="shrink-0 text-[10px] font-medium text-gray-500 uppercase tracking-wide">
                        your answer
                      </span>
                    )}
                    {countsVisible && (
                      <span className="shrink-0 text-xs font-semibold tabular-nums text-gray-500">
                        {count}
                      </span>
                    )}
                  </span>
                </button>
              );
            })}
          </div>

          {canAnswer && (
            <p className="text-center text-xs text-gray-400">Tap an answer</p>
          )}

          {isMuted && !isClosed && (
            <p className="text-center text-xs text-red-500">
              You have been muted by the host and cannot answer.
            </p>
          )}

          {!isHost && hasAnswered && !isClosed && (
            <p className="text-center text-xs text-gray-400">
              Answer sent — waiting for the results…
            </p>
          )}

          {/* Progress while open — the room deciding, without revealing what they chose. */}
          {!isClosed && (
            <div className="space-y-1.5">
              <div className="h-1 w-full rounded-full bg-gray-100 overflow-hidden">
                <div
                  className="h-full rounded-full bg-gray-300 transition-[width] duration-300"
                  style={{ width: `${Math.round((totalVotes / denominator) * 100)}%` }}
                />
              </div>
              <p className="text-center text-xs text-gray-400">
                <span className="font-semibold text-gray-600">{totalVotes}</span> of {denominator} answered
              </p>
            </div>
          )}

          {/* The reveal: how did the room do, and what should be re-taught. */}
          {isClosed && (
            <div className="poll-summary space-y-1 pt-1">
              {poll.isQuiz ? (
                <>
                  <p className="text-center text-sm font-semibold text-gray-800">
                    {correctCount} of {totalVotes} got this
                  </p>
                  {mostMissed && (
                    <p className="text-center text-xs text-amber-700">
                      {mostMissed.count}{" "}
                      {mostMissed.count === 1 ? "person picked" : "people picked"}{" "}
                      “{mostMissed.option.text}” — worth revisiting?
                    </p>
                  )}
                </>
              ) : (
                <p className="text-center text-sm text-gray-500">
                  {totalVotes} {totalVotes === 1 ? "answer" : "answers"}
                </p>
              )}
            </div>
          )}

          {isHost && (
            <div className="flex gap-2">
              {!isClosed ? (
                <button
                  onClick={onClosePoll}
                  className="btn btn-sm flex-1 text-white border-0 hover:opacity-90"
                  style={{ background: BRAND }}
                >
                  Show results
                </button>
              ) : (
                <>
                  <button onClick={onClearPoll} className="btn btn-sm flex-1 btn-ghost text-gray-600">
                    Back to slides
                  </button>
                  {/* Straight from the reveal into the next question — no detour via the tab. */}
                  {hasNextInSet && (
                    <button
                      onClick={onAskNext}
                      className="btn btn-sm flex-1 text-white border-0 hover:opacity-90"
                      style={{ background: BRAND }}
                    >
                      Next question
                    </button>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
