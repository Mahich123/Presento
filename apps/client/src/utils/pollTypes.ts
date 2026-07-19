export interface PollOption {
  id: string;
  text: string;
}

export interface Poll {
  id: string;
  question: string;
  options: PollOption[];
  // True when the host marked an answer correct — makes this a comprehension
  // check rather than an opinion poll.
  isQuiz: boolean;
  // Non-null only once the poll is closed — the server withholds the answer
  // while it's open so the reveal can't be spoiled.
  correctOptionId: string | null;
  status: "open" | "closed";
  durationMs: number | null;
  createdAt: number;
  // 1-based position when this came from a loaded set; null for an ad-hoc question.
  queuePosition: number | null;
  queueTotal: number | null;
}

export interface PollState {
  poll: Poll | null;
  counts: Record<string, number>;
  // False for viewers while the question is open — the server sends no tallies at all.
  countsVisible: boolean;
  totalVotes: number;
  eligibleVoters: number;
  myVote: string | null;
  // Milliseconds left on the clock, or null when there's no time limit.
  remainingMs: number | null;
  queueTotal: number;
  queueAsked: number;
  // Host-only: viewers get an empty array so they can't read ahead.
  queuePreview: { question: string; asked: boolean }[];
}

export const EMPTY_POLL_STATE: PollState = {
  poll: null,
  counts: {},
  countsVisible: false,
  totalVotes: 0,
  eligibleVoters: 0,
  myVote: null,
  remainingMs: null,
  queueTotal: 0,
  queueAsked: 0,
  queuePreview: [],
};

// GSAP doesn't honour the OS motion setting on its own — every animation here is
// decorative, so check this before running one.
export const prefersReducedMotion = () =>
  typeof window !== "undefined" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export const POLL_DURATIONS: { label: string; ms: number | null }[] = [
  { label: "15s", ms: 15_000 },
  { label: "30s", ms: 30_000 },
  { label: "60s", ms: 60_000 },
  { label: "Off", ms: null },
];

export const DEFAULT_POLL_DURATION_MS = 30_000;
