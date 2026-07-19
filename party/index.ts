import type * as Party from "partykit/server";
import { Filter } from "bad-words";

const filter = new Filter();

const cleanText = (text: string) => (filter.isProfane(text) ? filter.clean(text) : text);

const MIN_POLL_OPTIONS = 2;
const MAX_POLL_OPTIONS = 6;
const MIN_POLL_DURATION_MS = 5_000;
const MAX_POLL_DURATION_MS = 600_000;
const MAX_QUEUE_LENGTH = 50;

interface Poll {
  id: string;
  question: string;
  options: { id: string; text: string }[];
  isQuiz: boolean;
  correctOptionId: string | null;
  status: "open" | "closed";
  // null = no time limit; the host closes it by hand.
  durationMs: number | null;
  endsAt: number | null;
  createdAt: number;
  // 1-based position when this came from a queued set; null for an ad-hoc question.
  queuePosition: number | null;
  queueTotal: number | null;
}

// Someone waiting for the host to admit them to a locked room.
interface PendingJoin {
  connId: string;
  userId: string | null;
  userName: string;
  token: string;
  requestedAt: number;
  timer: ReturnType<typeof setTimeout>;
}

// A validated question waiting its turn. Same shape as a create_poll payload.
interface QueuedQuestion {
  question: string;
  options: string[];
  correctIndex: number | null;
  durationMs: number | null;
}

export default class Server implements Party.Server {
  slides: { pageNumber: number; imageUrl: string; pageId: string }[] = [];
  presentationId: string | null = null;
  pdfFileId: string | null = null;
  currentSlideIndex: number = 0;
  currentPoll: Poll | null = null;
  // userId -> optionId. Keyed by user so a reconnect keeps their answer and
  // one person can't stuff the ballot from two tabs.
  pollVotes: Map<string, string> = new Map();
  // A set of questions the host queued up ahead of time. They're fired one at a
  // time by the host — the queue never advances on its own.
  queue: QueuedQuestion[] = [];
  queueIndex: number = 0;
  pollSeq: number = 0;
  // Host-controlled room settings. In-memory like everything else here.
  chatEnabled: boolean = true;
  locked: boolean = false;
  // People knocking on a locked room, waiting for the host to let them in.
  // Keyed by connection id. Their sockets stay open so we can push the verdict,
  // but they are excluded from every broadcast, count and roster until admitted.
  pendingJoins: Map<string, PendingJoin> = new Map();
  readonly joinRequestTtlMs = 120_000;
  pollTimeout: ReturnType<typeof setTimeout> | null = null;
  pollTickInterval: ReturnType<typeof setInterval> | null = null;
  hostLeftTimeout: ReturnType<typeof setTimeout> | null = null;
  hostLeftTickInterval: ReturnType<typeof setInterval> | null = null;
  hostLeftEndsAt: number | null = null;
  readonly hostGraceMs = 90_000;
  disconnectTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();
  readonly userGraceMs = 45_000;

  constructor(readonly room: Party.Room) {}

  async getSlideContent(presentationId: string, token: string) {
    try {
      const slidesData: { pageNumber: number; imageUrl: string; pageId: string }[] = []
      const res = await fetch(
        `https://slides.googleapis.com/v1/presentations/${presentationId}`,
        {
          headers: { Authorization: `Bearer ${token}` },
        }
      );

      const data = await res.json();

      if (!res.ok) {
        console.error("Google Slides API error:", data);
        const reason = data?.error?.message || `Google Slides API error (${res.status})`;
        return { slides: [], error: reason };
      }

      if (!data.slides || !Array.isArray(data.slides)) {
        console.error("Invalid response from Google Slides API:", data);
        return { slides: [], error: "This file isn't a readable Google Slides presentation." };
      }

      data.slides.forEach((slide: any, i: number) => {
        const pageId = slide.objectId;
        const imageUrl = `https://www.googleapis.com/drive/v3/files/${presentationId}/export?mimeType=image/png&page=${i}`;
    
        slidesData.push({
          pageNumber: i + 1,
          imageUrl: imageUrl,
          pageId: pageId
        });
      });

      return { slides: slidesData };
    } catch (error) {
      console.error("Error fetching slide content:", error);
      return { slides: [], error: "Network error while fetching slides from Google." };
    }
}

  async onRequest(request: Party.Request) {
    if (request.method === "POST") {
      // Consume request body before responding to avoid workerd stream errors
      await request.text();
      return new Response(`Room ${this.room.id} created/connected via POST`, {
        status: 200,
      });
    }

    return new Response("Not found", { status: 404 });
  }

  broadcastUserCount() {
    // Use userId when resolved; fall back to connection ID so users whose
    // session couldn't be resolved yet (backend cold-start) are still counted.
    const uniqueIds = new Set(
      this.getConnectionsWithState()
        .map(({ conn, state }) => state?.userId ?? conn.id)
    );
    const count = uniqueIds.size;
    this.broadcast(JSON.stringify({
      type: "user_count",
      count,
    }));
    // The "8 of 12 voted" denominator moves when people come and go, so an
    // open poll has to be re-sent alongside the count.
    if (this.currentPoll?.status === "open") {
      this.broadcastPollState();
    }
    // The host's roster changes on the same events that change the count.
    this.broadcastParticipants();
  }

  async resolveUserNameFromSessionToken(token: string) {
    const backendBaseUrl = this.getBackendBaseUrl();
    const url = `${backendBaseUrl}/api/party/session-user?roomId=${encodeURIComponent(this.room.id)}`;
    const headers = { Authorization: `Bearer ${token}` };

    const tryFetch = async () => {
      const response = await fetch(url, {
        method: "GET",
        headers,
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) {
        console.error(`resolveUser: backend returned ${response.status}`);
        return null;
      }
      const data = await response.json() as { userId?: string; userName?: string; role?: "host" | "viewer" | null; isMuted?: boolean };
      return {
        userId: data.userId,
        userName: data.userName,
        role: data.role ?? undefined,
        isMuted: data.isMuted ?? false,
      };
    };

    // Attempt 1
    try {
      const result = await tryFetch();
      if (result) return result;
    } catch (error) {
      console.error("resolveUser attempt 1 failed:", error);
    }

    // Retry once after 800ms — handles backend cold-starts and transient errors
    await new Promise(r => setTimeout(r, 800));
    try {
      return await tryFetch();
    } catch (error) {
      console.error("resolveUser attempt 2 failed:", error);
      return null;
    }
  }

  async toggleMuteInBackend(hostToken: string, targetUserId: string): Promise<boolean | null> {
    try {
      const response = await fetch(`${this.getBackendBaseUrl()}/api/party/${this.room.id}/mute/${targetUserId}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${hostToken}`,
        },
      });
      if (!response.ok) return null;
      const data = await response.json() as { isMuted?: boolean };
      return data.isMuted ?? null;
    } catch (error) {
      console.error("Failed to toggle mute in backend:", error);
      return null;
    }
  }

  getBackendBaseUrl() {
    return (
      (this.room.env as Record<string, string>)?.BACKEND_BASE_URL || "http://localhost:4002"
    );
  }

  async sendPresenceEvent(token: string, event: "connect" | "disconnect") {
    try {
      await fetch(`${this.getBackendBaseUrl()}/api/party/${this.room.id}/presence`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ event }),
      });
    } catch (error) {
      console.error(`Failed to send presence ${event} for room ${this.room.id}:`, error);
    }
  }

  async closeRoomInBackend(token: string) {
    try {
      await fetch(`${this.getBackendBaseUrl()}/api/party/${this.room.id}/close`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
    } catch (error) {
      console.error(`Failed to close room ${this.room.id} in backend:`, error);
    }
  }

  /**
   * Is this user already in the room right now? True while they hold a live
   * connection, or while they're inside the disconnect grace window after a
   * blip. Used to decide who a locked room still lets through.
   */
  isAlreadyInRoom(userId: string): boolean {
    if (this.disconnectTimers.has(userId)) return true;
    return this.getConnectionsWithState().some(({ state }) => state?.userId === userId);
  }

  /**
   * Broadcast to admitted connections only. Anyone still waiting on the host's
   * approval must not receive room content — chat, polls or slides.
   */
  broadcast(msg: string, without: string[] = []) {
    const excluded = this.pendingJoins.size
      ? [...without, ...this.pendingJoins.keys()]
      : without;
    this.room.broadcast(msg, excluded);
  }

  // Pending connections are deliberately invisible here, so every existing
  // count, roster and per-connection loop treats them as not in the room yet.
  getConnectionsWithState() {
    return Array.from(this.room.getConnections())
      .filter((conn) => !this.pendingJoins.has(conn.id))
      .map((conn) => ({
        conn,
        state: (conn.state as { userId?: string; userName?: string; role?: "host" | "viewer"; token?: string; isMuted?: boolean } | null) ?? null,
      }));
  }

  hasConnectedHost() {
    return this.getConnectionsWithState().some(({ state }) => state?.role === "host");
  }

  // Built from live connections rather than the DB: the host needs who's in the
  // room *now*, with names, and conn.state already carries both.
  buildParticipants() {
    const byUser = new Map<string, { userId: string; userName: string; role: string; isMuted: boolean }>();
    for (const { state } of this.getConnectionsWithState()) {
      if (!state?.userId) continue;
      byUser.set(state.userId, {
        userId: state.userId,
        userName: state.userName || "Someone",
        role: state.role || "viewer",
        isMuted: state.isMuted ?? false,
      });
    }
    return Array.from(byUser.values()).sort(
      (a, b) => (a.role === "host" ? -1 : b.role === "host" ? 1 : 0) || a.userName.localeCompare(b.userName),
    );
  }

  // Host-only: the roster isn't something viewers need, or should have.
  broadcastParticipants() {
    const participants = this.buildParticipants();
    const message = JSON.stringify({ type: "participants", participants });
    for (const { conn, state } of this.getConnectionsWithState()) {
      if (state?.role === "host") conn.send(message);
    }
  }

  broadcastRoomSettings() {
    this.broadcast(JSON.stringify({
      type: "room_settings",
      chatEnabled: this.chatEnabled,
      locked: this.locked,
    }));
  }

  // A connection's role can still be "viewer" for a few seconds after connect if the
  // backend was cold-starting when we resolved it, so re-resolve once before rejecting.
  async requireHost(sender: Party.Connection, errorMessage: string) {
    let effectiveState = sender.state as { role?: string; token?: string; userId?: string } | null;
    if (effectiveState?.role === "host") return effectiveState;

    if (effectiveState?.token) {
      const freshInfo = await this.resolveUserNameFromSessionToken(effectiveState.token);
      if (freshInfo) {
        sender.setState({
          ...(sender.state as object),
          userId: freshInfo.userId,
          userName: freshInfo.userName || `User ${sender.id.slice(0, 4)}`,
          role: freshInfo.role || effectiveState.role || "viewer",
          isMuted: freshInfo.isMuted ?? false,
        });
      }
    }

    effectiveState = sender.state as { role?: string; token?: string; userId?: string } | null;
    if (effectiveState?.role !== "host") {
      sender.send(JSON.stringify({ type: "error", errorCode: "unauthorized_role", message: errorMessage }));
      return null;
    }
    return effectiveState;
  }

  // How many people could actually vote — viewers only, since the host doesn't
  // get a ballot. Powers the "8 of 12 voted" counter.
  countEligibleVoters() {
    const ids = new Set<string>();
    for (const { conn, state } of this.getConnectionsWithState()) {
      if (state?.role === "host") continue;
      ids.add(state?.userId ?? conn.id);
    }
    return ids.size;
  }

  clearPollTimer() {
    if (this.pollTimeout) {
      clearTimeout(this.pollTimeout);
      this.pollTimeout = null;
    }
    if (this.pollTickInterval) {
      clearInterval(this.pollTickInterval);
      this.pollTickInterval = null;
    }
  }

  broadcastPollTick() {
    if (!this.currentPoll?.endsAt) return;
    this.broadcast(JSON.stringify({
      type: "poll_tick",
      remainingMs: Math.max(0, this.currentPoll.endsAt - Date.now()),
    }));
  }

  startPollTimer() {
    this.clearPollTimer();
    if (!this.currentPoll?.endsAt) return;
    // The deadline is server-authoritative and ticks are pushed every second, so
    // clients never have to trust their own clock.
    this.pollTickInterval = setInterval(() => this.broadcastPollTick(), 1000);
    this.pollTimeout = setTimeout(
      () => this.closeCurrentPoll(),
      Math.max(0, this.currentPoll.endsAt - Date.now()),
    );
  }

  // Validate an incoming question once, so an ad-hoc question and a queued one
  // can never diverge in what they accept.
  normalizeQuestion(data: Record<string, unknown>): QueuedQuestion | null {
    const question = String(data.question ?? "").trim().slice(0, 200);
    const options = (Array.isArray(data.options) ? data.options : [])
      .map((option: unknown) => String(option ?? "").trim().slice(0, 100))
      .filter((option: string) => option.length > 0)
      .slice(0, MAX_POLL_OPTIONS);

    if (!question || options.length < MIN_POLL_OPTIONS) return null;

    const rawCorrect = typeof data.correctIndex === "number" ? data.correctIndex : null;
    const correctIndex =
      rawCorrect !== null && Number.isInteger(rawCorrect) && rawCorrect >= 0 && rawCorrect < options.length
        ? rawCorrect
        : null;

    const rawDuration = typeof data.durationMs === "number" ? data.durationMs : null;
    const durationMs =
      rawDuration && Number.isFinite(rawDuration) && rawDuration > 0
        ? Math.min(MAX_POLL_DURATION_MS, Math.max(MIN_POLL_DURATION_MS, Math.round(rawDuration)))
        : null;

    return { question, options, correctIndex, durationMs };
  }

  openQuestion(
    q: QueuedQuestion,
    queuePosition: number | null = null,
    queueTotal: number | null = null,
  ) {
    // Sequence rather than a timestamp: two questions fired in the same
    // millisecond would otherwise collide on id.
    const pollId = `q${++this.pollSeq}`;
    this.clearPollTimer();
    this.pollVotes.clear();
    this.currentPoll = {
      id: pollId,
      question: cleanText(q.question),
      options: q.options.map((text, index) => ({ id: `${pollId}-${index}`, text: cleanText(text) })),
      isQuiz: q.correctIndex !== null,
      correctOptionId: q.correctIndex !== null ? `${pollId}-${q.correctIndex}` : null,
      status: "open",
      durationMs: q.durationMs,
      endsAt: q.durationMs ? Date.now() + q.durationMs : null,
      createdAt: Date.now(),
      queuePosition,
      queueTotal,
    };
    this.startPollTimer();
    this.broadcastPollState();
  }

  // The single close path — both the host's button and the expiring clock land here.
  closeCurrentPoll() {
    if (!this.currentPoll || this.currentPoll.status === "closed") return;
    this.clearPollTimer();
    this.currentPoll.status = "closed";
    this.currentPoll.endsAt = null;
    this.broadcastPollState();
  }

  // Every connection gets its own view of a poll: its own vote, and — while
  // voting is open — no tallies unless it's the host. Withholding the counts
  // here rather than in the UI is the only way viewers genuinely can't see them.
  buildPollStateFor(userId?: string, role?: string) {
    const base = {
      type: "poll_state",
      eligibleVoters: this.countEligibleVoters(),
      queueTotal: this.queue.length,
      queueAsked: this.queueIndex,
      // Only the host needs the un-asked questions — sending them to viewers
      // would hand them the questions early.
      queuePreview:
        role === "host"
          ? this.queue.map((q, i) => ({ question: q.question, asked: i < this.queueIndex }))
          : [],
    };

    if (!this.currentPoll) {
      return { ...base, poll: null, counts: {}, countsVisible: false, totalVotes: 0, myVote: null, remainingMs: null };
    }

    const isClosed = this.currentPoll.status === "closed";
    const countsVisible = isClosed || role === "host";

    const counts: Record<string, number> = {};
    for (const option of this.currentPoll.options) counts[option.id] = 0;
    for (const optionId of this.pollVotes.values()) {
      if (counts[optionId] !== undefined) counts[optionId]++;
    }

    return {
      ...base,
      poll: {
        ...this.currentPoll,
        correctOptionId: isClosed ? this.currentPoll.correctOptionId : null,
      },
      counts: countsVisible ? counts : {},
      countsVisible,
      // Always sent: how many answered is not the same as what they answered.
      totalVotes: this.pollVotes.size,
      myVote: userId ? this.pollVotes.get(userId) ?? null : null,
      remainingMs: this.currentPoll.endsAt
        ? Math.max(0, this.currentPoll.endsAt - Date.now())
        : null,
    };
  }

  broadcastPollState() {
    for (const { conn, state } of this.getConnectionsWithState()) {
      conn.send(JSON.stringify(this.buildPollStateFor(state?.userId, state?.role)));
    }
  }

  broadcastHostTimerTick() {
    if (!this.hostLeftEndsAt) return;
    const remainingMs = Math.max(0, this.hostLeftEndsAt - Date.now());
    this.broadcast(
      JSON.stringify({
        type: "host_left_tick",
        remainingMs,
        endsAt: this.hostLeftEndsAt,
      })
    );
  }

  clearHostLeftTimer(notifyViewers = false) {
    if (this.hostLeftTimeout) {
      clearTimeout(this.hostLeftTimeout);
      this.hostLeftTimeout = null;
    }
    if (this.hostLeftTickInterval) {
      clearInterval(this.hostLeftTickInterval);
      this.hostLeftTickInterval = null;
    }
    this.hostLeftEndsAt = null;
    if (notifyViewers) {
      this.broadcast(JSON.stringify({ type: "host_returned" }));
    }
  }

  async forceCloseRoom(reason: "no_participants" | "host_timeout") {
    // Don't leave a poll tick running against a room that no longer exists.
    this.clearPollTimer();
    const connectionWithToken = this.getConnectionsWithState().find(({ state }) => !!state?.token);
    if (connectionWithToken?.state?.token) {
      await this.closeRoomInBackend(connectionWithToken.state.token);
    }
    this.broadcast(JSON.stringify({ type: "room_closed", reason }));
    for (const connection of Array.from(this.room.getConnections())) {
      connection.close(4002, reason);
    }
  }

  async updateRoomLifecycle() {
    const allConnections = this.getConnectionsWithState();
    const totalConnections = allConnections.length;

    if (totalConnections === 0) {
      this.clearHostLeftTimer();
      return;
    }

    const hostConnected = this.hasConnectedHost();

    if (hostConnected) {
      const hadTimer = !!this.hostLeftEndsAt;
      this.clearHostLeftTimer(hadTimer);
      return;
    }

    if (this.hostLeftEndsAt) {
      return;
    }

    this.hostLeftEndsAt = Date.now() + this.hostGraceMs;
    this.broadcast(
      JSON.stringify({
        type: "host_left",
        endsAt: this.hostLeftEndsAt,
        remainingMs: this.hostGraceMs,
      })
    );
    this.broadcastHostTimerTick();

    this.hostLeftTickInterval = setInterval(() => {
      this.broadcastHostTimerTick();
    }, 1000);

    this.hostLeftTimeout = setTimeout(async () => {
      this.clearHostLeftTimer();
      await this.forceCloseRoom("host_timeout");
    }, this.hostGraceMs);
  }

  async onConnect(conn: Party.Connection, ctx: Party.ConnectionContext) {
    const token = new URL(ctx.request.url).searchParams.get("token");

    if (!token) {
      conn.close(4001, "Unauthorized");
      return;
    }

    const userInfo = await this.resolveUserNameFromSessionToken(token);

    // A locked room doesn't admit newcomers on its own — it asks the host.
    // Someone already in it passes straight through: a live connection (second
    // tab) or an unexpired disconnect grace window (a genuine reconnect), so a
    // dropped wifi signal never needs re-approval. The host always gets in.
    if (
      this.locked &&
      userInfo?.role !== "host" &&
      !(userInfo?.userId && this.isAlreadyInRoom(userInfo.userId))
    ) {
      this.holdForApproval(conn, token, userInfo);
      return;
    }

    await this.admitConnection(conn, token, userInfo);
  }

  /**
   * Park a connection outside the room until the host decides. The socket stays
   * open so we can push the verdict, but `pendingJoins` keeps it out of every
   * broadcast, count and roster in the meantime.
   */
  holdForApproval(
    conn: Party.Connection,
    token: string,
    userInfo: { userId?: string; userName?: string } | null,
  ) {
    const userName = userInfo?.userName || `Guest ${conn.id.slice(0, 4)}`;

    const existing = this.pendingJoins.get(conn.id);
    if (existing) clearTimeout(existing.timer);

    const timer = setTimeout(() => {
      // Don't leave someone staring at a spinner forever if the host never looks.
      this.rejectPending(conn.id, "no_answer");
    }, this.joinRequestTtlMs);

    this.pendingJoins.set(conn.id, {
      connId: conn.id,
      userId: userInfo?.userId ?? null,
      userName,
      token,
      requestedAt: Date.now(),
      timer,
    });

    conn.send(JSON.stringify({
      type: "join_pending",
      message: "Waiting for the host to let you in.",
      expiresAt: Date.now() + this.joinRequestTtlMs,
    }));
    this.broadcastJoinRequests();
  }

  buildJoinRequests() {
    return Array.from(this.pendingJoins.values())
      .sort((a, b) => a.requestedAt - b.requestedAt)
      .map(({ connId, userId, userName, requestedAt }) => ({
        connId,
        userId,
        userName,
        requestedAt,
      }));
  }

  // Host-only, like the roster — viewers have no business seeing who's knocking.
  broadcastJoinRequests() {
    const requests = this.buildJoinRequests();
    const msg = JSON.stringify({ type: "join_requests", requests });
    for (const { conn, state } of this.getConnectionsWithState()) {
      if (state?.role === "host") conn.send(msg);
    }
  }

  /** Turn someone away, either by the host's choice or because nobody answered. */
  rejectPending(connId: string, reason: "denied" | "no_answer") {
    const pending = this.pendingJoins.get(connId);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pendingJoins.delete(connId);

    const conn = Array.from(this.room.getConnections()).find((c) => c.id === connId);
    if (conn) {
      conn.send(JSON.stringify({
        type: "join_denied",
        reason,
        message:
          reason === "denied"
            ? "The host didn't let you into this room."
            : "The host didn't respond. Try again in a moment.",
      }));
      conn.close(4003, reason === "denied" ? "Join denied" : "No answer");
    }
    this.broadcastJoinRequests();
  }

  /** Let a waiting connection in, running the normal join path. */
  async approvePending(connId: string) {
    const pending = this.pendingJoins.get(connId);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pendingJoins.delete(connId);

    const conn = Array.from(this.room.getConnections()).find((c) => c.id === connId);
    if (!conn) {
      // They gave up and closed the tab while the host was deciding.
      this.broadcastJoinRequests();
      return;
    }

    // Re-resolve rather than trusting what we captured at knock time — role or
    // mute state may have changed, and it may have failed transiently before.
    const userInfo = await this.resolveUserNameFromSessionToken(pending.token);
    conn.send(JSON.stringify({ type: "join_approved" }));
    await this.admitConnection(conn, pending.token, userInfo);
    this.broadcastJoinRequests();
  }

  /** The full join path, shared by a normal connect and a host approval. */
  async admitConnection(
    conn: Party.Connection,
    token: string,
    userInfo: Awaited<ReturnType<Server["resolveUserNameFromSessionToken"]>>,
  ) {
    conn.setState({
      token,
      userId: userInfo?.userId,
      userName: userInfo?.userName || `User ${conn.id.slice(0, 4)}`,
      role: userInfo?.role || "viewer",
      isMuted: userInfo?.isMuted ?? false,
      _joinSent: false,
    });

    // Cancel grace period timer if the user is reconnecting before it expired
    let wasInGracePeriod = false;
    if (userInfo?.userId) {
      const pendingTimer = this.disconnectTimers.get(userInfo.userId);
      if (pendingTimer) {
        clearTimeout(pendingTimer);
        this.disconnectTimers.delete(userInfo.userId);
        wasInGracePeriod = true;
      }
    }

    const sameUserConnections = this.getConnectionsWithState().filter(
      ({ state }) => state?.userId && state?.userId === userInfo?.userId
    );
    if (userInfo?.userId && sameUserConnections.length === 1) {
      const joinMsg = JSON.stringify({
        type: "user_joined",
        userId: userInfo.userId,
        userName: userInfo.userName || `User ${conn.id.slice(0, 4)}`,
      });
      for (const connection of Array.from(this.room.getConnections())) {
        if (connection.id !== conn.id) connection.send(joinMsg);
      }
      if (!wasInGracePeriod) {
        await this.sendPresenceEvent(token, "connect");
      }
      conn.setState({
        ...(conn.state as object),
        _joinSent: true,
      });
    }

    conn.send(JSON.stringify({ type: "connected", message: `Welcome ${conn.id}` }));

    if (this.slides.length > 0) {
      conn.send(JSON.stringify({
        type: "slide_content",
        slides: this.slides,
        presentationId: this.presentationId
      }));
      conn.send(JSON.stringify({
        type: "slide_change",
        slideIndex: this.currentSlideIndex
      }));
    } else if (this.pdfFileId) {
      conn.send(JSON.stringify({
        type: "pdf_content",
        fileId: this.pdfFileId
      }));
      conn.send(JSON.stringify({
        type: "slide_change",
        slideIndex: this.currentSlideIndex
      }));
    }

    if (this.hostLeftEndsAt && !this.hasConnectedHost()) {
      const remainingMs = Math.max(0, this.hostLeftEndsAt - Date.now());
      conn.send(JSON.stringify({
        type: "host_left",
        endsAt: this.hostLeftEndsAt,
        remainingMs,
        totalMs: this.hostGraceMs,
      }));
    }

    if (userInfo?.isMuted) {
      conn.send(JSON.stringify({ type: "mute_status", userId: userInfo.userId, isMuted: true }));
    }

    if (this.currentPoll) {
      conn.send(JSON.stringify(this.buildPollStateFor(userInfo?.userId, userInfo?.role)));
    }

    // Replay room settings to every joiner, and the roster to a joining host.
    conn.send(JSON.stringify({
      type: "room_settings",
      chatEnabled: this.chatEnabled,
      locked: this.locked,
    }));
    if (userInfo?.role === "host") {
      this.broadcastParticipants();
      // A host arriving mid-session needs to see anyone already knocking.
      this.broadcastJoinRequests();
    }

    this.broadcastUserCount();
    // Only run lifecycle check when a host connects. Running it for every viewer
    // connection causes a false host_left timer to start if the host's role
    // wasn't resolved yet (e.g. backend cold-start). The timer is correctly
    // driven by onClose's grace-period path when the host truly disconnects.
    if (userInfo?.role === "host") {
      await this.updateRoomLifecycle();
    }

    // Schedule a background re-resolve when:
    //  - userInfo is null entirely (fetch failed — cold-start / transient error)
    //  - userInfo.userId is missing (session not found in DB)
    //  - userInfo.role is null (race condition: participant row not yet committed when we queried)
    const needsRetry = !userInfo || !userInfo.userId || !userInfo.role;
    // Use a shorter delay when we already have partial info (role is the only thing missing)
    const retryDelayMs = userInfo?.userId ? 800 : 3000;
    if (needsRetry) {
      setTimeout(async () => {
        const isStillConnected = Array.from(this.room.getConnections()).some(c => c.id === conn.id);
        if (!isStillConnected) return;
        const retryInfo = await this.resolveUserNameFromSessionToken(token);
        if (!retryInfo) return;
        const prevState = (conn.state as { _joinSent?: boolean } | null) ?? {};
        conn.setState({
          token,
          userId: retryInfo.userId,
          userName: retryInfo.userName || `User ${conn.id.slice(0, 4)}`,
          role: retryInfo.role || "viewer",
          isMuted: retryInfo.isMuted ?? false,
          _joinSent: prevState._joinSent ?? false,
        });
        this.broadcastUserCount();

        // Their userId only just resolved, so resend the poll with their own vote filled in.
        if (this.currentPoll) {
          conn.send(JSON.stringify(this.buildPollStateFor(retryInfo.userId, retryInfo.role)));
        }

        // Send join notification only if it wasn't already sent during onConnect
        if (retryInfo.userId && !prevState._joinSent) {
          const sameUserConnections = this.getConnectionsWithState().filter(
            ({ state }) => state?.userId && state?.userId === retryInfo.userId
          );
          if (sameUserConnections.length === 1) {
            const joinMsg = JSON.stringify({
              type: "user_joined",
              userId: retryInfo.userId,
              userName: retryInfo.userName || `User ${conn.id.slice(0, 4)}`,
            });
            for (const connection of Array.from(this.room.getConnections())) {
              if (connection.id !== conn.id) connection.send(joinMsg);
            }
            await this.sendPresenceEvent(token, "connect");
            conn.setState({ ...(conn.state as object), _joinSent: true });
          }
        }

        if (retryInfo.role === "host") {
          await this.updateRoomLifecycle();
        }
      }, retryDelayMs);
    }
  }

  async onClose(conn: Party.Connection) {
    // Someone who gave up waiting was never admitted — drop their request and
    // refresh the host's list. No presence or lifecycle handling applies.
    const pending = this.pendingJoins.get(conn.id);
    if (pending) {
      clearTimeout(pending.timer);
      this.pendingJoins.delete(conn.id);
      this.broadcastJoinRequests();
      return;
    }

    const state = (conn.state as { userId?: string; token?: string; userName?: string; role?: string } | null) ?? null;
    const sameUserStillConnected = this.getConnectionsWithState().some(
      ({ conn: connectedConn, state: connectedState }) =>
        connectedConn.id !== conn.id &&
        !!state?.userId &&
        connectedState?.userId === state.userId
    );

    if (state?.token && state?.userId && !sameUserStillConnected) {
      const userId = state.userId;
      const token = state.token;
      const userName = state.userName;
      const role = state.role;

      const existing = this.disconnectTimers.get(userId);
      if (existing) clearTimeout(existing);

      this.broadcast(JSON.stringify({
        type: "user_left",
        userId,
        userName: userName || "Someone",
      }));

      const timer = setTimeout(async () => {
        this.disconnectTimers.delete(userId);
        await this.sendPresenceEvent(token, "disconnect");
        await this.updateRoomLifecycle();
      }, this.userGraceMs);

      this.disconnectTimers.set(userId, timer);

      // For host: delay lifecycle update by the same grace period so a quick
      // reconnect doesn't immediately broadcast host_left to viewers.
      if (role === "host") {
        // Start host timer immediately; a quick reconnect will clear it via updateRoomLifecycle.
        await this.updateRoomLifecycle();
        this.broadcastUserCount();
        return;
      }
    }

    this.broadcastUserCount();
    if (state?.userId) {
      await this.updateRoomLifecycle();
    }
  }

  async onMessage(message: string, sender: Party.Connection) {
    try {
      const data = JSON.parse(message);

      if (data.type === "load_slide") {
        if (!data.presentationId) return;

        const { slides: slideContent, error: slideError } = await this.getSlideContent(
          data.presentationId,
          data.token
        );

        if (slideContent.length === 0) {
          console.error("Failed to load slides - no content returned");
          sender.send(JSON.stringify({
            type: "error",
            message: slideError || "Failed to load presentation slides"
          }));
          return;
        }

        const isNewPresentation = this.presentationId !== data.presentationId;
        this.slides = slideContent;
        this.presentationId = data.presentationId;
        this.pdfFileId = null;
        if (isNewPresentation) {
          this.currentSlideIndex = 0;
        }

        this.broadcast(
          JSON.stringify({
            type: "slide_content",
            slides: slideContent,
            presentationId: data.presentationId
          }),
        );
      } else if (data.type === "load_pdf") {
        if (!data.fileId) return;

        const isNewPdf = this.pdfFileId !== data.fileId;
        this.pdfFileId = data.fileId;
        this.slides = [];
        this.presentationId = null;
        if (isNewPdf) {
          this.currentSlideIndex = 0;
        }

        this.broadcast(
          JSON.stringify({
            type: "pdf_content",
            fileId: data.fileId
          }),
        );
      } else if (data.type === "slide_change") {
        this.currentSlideIndex = data.slideIndex;
        this.broadcast(
          JSON.stringify({
            type: "slide_change",
            slideIndex: data.slideIndex,
          }),
          [sender.id]
        );
      } else if (data.type === "chat_message") {
        const state = sender.state as { userId?: string; userName?: string; isMuted?: boolean; role?: string } | null;
        // Host can always post — turning chat off silences the room, not themselves.
        if (!this.chatEnabled && state?.role !== "host") {
          sender.send(JSON.stringify({
            type: "error",
            message: "The host has turned off chat."
          }));
          return;
        }
        if (state?.isMuted) {
          sender.send(JSON.stringify({
            type: "error",
            message: "You are muted by the host and cannot send messages."
          }));
          return;
        }
        const userName = state?.userName || `User ${sender.id.slice(0, 4)}`;
        const raw = String(data.message ?? "");
        const hasProfanity = filter.isProfane(raw);
        const cleanMessage = hasProfanity ? filter.clean(raw) : raw;
        this.broadcast(
          JSON.stringify({
            type: "chat_message",
            id: `${sender.id}-${Date.now()}`,
            userId: state?.userId || sender.id,
            userName: userName,
            role: (sender.state as { role?: string } | null)?.role ?? "viewer",
            message: cleanMessage,
            timestamp: Date.now()
          })
        );
        if (hasProfanity) {
          sender.send(JSON.stringify({
            type: "chat_warning",
            message: "Your message contained inappropriate language and was filtered."
          }));
        }
      } else if (data.type === "cursor_move" || data.type === "cursor_hide") {
        const senderState = sender.state as { role?: string; token?: string } | null;
        if (senderState?.role !== "host") return;
        this.broadcast(JSON.stringify(data), [sender.id]);
      } else if (data.type === "mute_user") {
        const senderState = sender.state as { role?: string; token?: string; userId?: string } | null;
        let effectiveState = senderState;
        if (effectiveState?.role !== "host") {
          if (effectiveState?.token) {
            const freshInfo = await this.resolveUserNameFromSessionToken(effectiveState.token);
            if (freshInfo) {
              sender.setState({
                token: effectiveState.token,
                userId: freshInfo.userId,
                userName: freshInfo.userName || `User ${sender.id.slice(0, 4)}`,
                role: freshInfo.role || effectiveState.role || "viewer",
                isMuted: freshInfo.isMuted ?? false,
              });
            }
          }
          effectiveState = sender.state as { role?: string; token?: string } | null;
          if (effectiveState?.role !== "host") {
            sender.send(JSON.stringify({ type: "error", errorCode: "unauthorized_role", message: "Only the host can mute users." }));
            return;
          }
        }
        const targetUserId = data.userId as string | undefined;
        if (!targetUserId || !effectiveState?.token) return;

        const newMuteState = await this.toggleMuteInBackend(effectiveState.token, targetUserId);
        if (newMuteState === null) {
          sender.send(JSON.stringify({ type: "error", message: "Failed to update mute state." }));
          return;
        }

        // Update the target user's connection state
        for (const { conn, state } of this.getConnectionsWithState()) {
          if (state?.userId === targetUserId) {
            conn.setState({ ...state, isMuted: newMuteState });
          }
        }

        // Broadcast mute status to all connections so host and target see the update
        this.broadcast(JSON.stringify({
          type: "mute_status",
          userId: targetUserId,
          isMuted: newMuteState,
        }));
        this.broadcastParticipants();
      } else if (data.type === "create_poll") {
        const hostState = await this.requireHost(sender, "Only the host can start a poll.");
        if (!hostState) return;

        const normalized = this.normalizeQuestion(data);
        if (!normalized) {
          sender.send(JSON.stringify({
            type: "error",
            message: `A question needs text and at least ${MIN_POLL_OPTIONS} answers.`,
          }));
          return;
        }
        // Asking ad-hoc leaves any loaded queue untouched.
        this.openQuestion(normalized);
      } else if (data.type === "poll_vote") {
        if (!this.currentPoll || this.currentPoll.status !== "open") return;

        const state = sender.state as { userId?: string; isMuted?: boolean } | null;
        if (state?.isMuted) {
          sender.send(JSON.stringify({
            type: "error",
            message: "You are muted by the host and cannot answer.",
          }));
          return;
        }

        // Without a resolved userId we can't dedupe answers, so drop it rather
        // than let one unresolved connection answer repeatedly.
        const voterId = state?.userId;
        if (!voterId) return;

        const optionId = String(data.optionId ?? "");
        if (!this.currentPoll.options.some((option) => option.id === optionId)) return;

        this.pollVotes.set(voterId, optionId);
        this.broadcastPollState();
      } else if (data.type === "close_poll") {
        const hostState = await this.requireHost(sender, "Only the host can close a poll.");
        if (!hostState) return;
        this.closeCurrentPoll();
      } else if (data.type === "clear_poll") {
        const hostState = await this.requireHost(sender, "Only the host can clear a question.");
        if (!hostState) return;
        this.clearPollTimer();
        this.currentPoll = null;
        this.pollVotes.clear();
        // The queue outlives any single question — clearing one doesn't discard the set.
        this.broadcastPollState();
      } else if (data.type === "load_queue") {
        const hostState = await this.requireHost(sender, "Only the host can load a question set.");
        if (!hostState) return;
        const incoming = Array.isArray(data.questions) ? data.questions : [];
        // Drop anything malformed rather than rejecting the whole set — a half-finished
        // draft in the host's browser shouldn't block the good questions.
        this.queue = incoming
          .slice(0, MAX_QUEUE_LENGTH)
          .map((q: Record<string, unknown>) => this.normalizeQuestion(q))
          .filter((q: QueuedQuestion | null): q is QueuedQuestion => q !== null);
        this.queueIndex = 0;
        if (this.queue.length === 0) {
          sender.send(JSON.stringify({ type: "error", message: "That set has no usable questions." }));
        }
        this.broadcastPollState();
      } else if (data.type === "ask_next") {
        const hostState = await this.requireHost(sender, "Only the host can ask the next question.");
        if (!hostState) return;
        if (this.queueIndex >= this.queue.length) return;
        const next = this.queue[this.queueIndex];
        this.queueIndex++;
        // Replaces whatever is on screen, so the host can go reveal -> next in one tap.
        this.openQuestion(next, this.queueIndex, this.queue.length);
      } else if (data.type === "clear_queue") {
        const hostState = await this.requireHost(sender, "Only the host can clear the question set.");
        if (!hostState) return;
        this.queue = [];
        this.queueIndex = 0;
        this.broadcastPollState();
      } else if (data.type === "set_chat_enabled") {
        const hostState = await this.requireHost(sender, "Only the host can change chat settings.");
        if (!hostState) return;
        this.chatEnabled = data.enabled !== false;
        this.broadcastRoomSettings();
      } else if (data.type === "set_locked") {
        const hostState = await this.requireHost(sender, "Only the host can lock the room.");
        if (!hostState) return;
        this.locked = data.locked === true;
        this.broadcastRoomSettings();
        // Unlocking answers everyone still knocking — no reason to make them
        // wait for individual approval once the door is open again.
        if (!this.locked && this.pendingJoins.size) {
          for (const connId of Array.from(this.pendingJoins.keys())) {
            await this.approvePending(connId);
          }
        }
      } else if (data.type === "approve_join") {
        const hostState = await this.requireHost(sender, "Only the host can admit people.");
        if (!hostState) return;
        if (typeof data.connId === "string") await this.approvePending(data.connId);
      } else if (data.type === "deny_join") {
        const hostState = await this.requireHost(sender, "Only the host can admit people.");
        if (!hostState) return;
        if (typeof data.connId === "string") this.rejectPending(data.connId, "denied");
      } else if (data.type === "request_participants") {
        const hostState = await this.requireHost(sender, "Only the host can view participants.");
        if (!hostState) return;
        sender.send(JSON.stringify({ type: "participants", participants: this.buildParticipants() }));
        sender.send(JSON.stringify({ type: "join_requests", requests: this.buildJoinRequests() }));
      } else if (data.type === "verify_role") {
        // Client requests an immediate role re-resolution (e.g. host just enabled laser pointer
        // but their role may still be "viewer" because background resolve hasn't fired yet).
        const senderState = sender.state as { token?: string; role?: string; userId?: string; userName?: string; isMuted?: boolean; _joinSent?: boolean } | null;
        if (!senderState?.token) return;
        const freshInfo = await this.resolveUserNameFromSessionToken(senderState.token);
        if (!freshInfo) return;
        const prevJoinSent = senderState._joinSent ?? false;
        sender.setState({
          token: senderState.token,
          userId: freshInfo.userId,
          userName: freshInfo.userName || senderState.userName || `User ${sender.id.slice(0, 4)}`,
          role: freshInfo.role || senderState.role || "viewer",
          isMuted: freshInfo.isMuted ?? senderState.isMuted ?? false,
          _joinSent: prevJoinSent,
        });
        if (freshInfo.role === "host") {
          await this.updateRoomLifecycle();
        }
      }
    } catch (error) {
      console.error("Error processing message:", error);
    }
  }
}
