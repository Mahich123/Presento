import type * as Party from "partykit/server";

export default class Server implements Party.Server {
  slides: { pageNumber: number; imageUrl: string; pageId: string }[] = [];
  presentationId: string | null = null;
  currentSlideIndex: number = 0;
  hostLeftTimeout: ReturnType<typeof setTimeout> | null = null;
  hostLeftTickInterval: ReturnType<typeof setInterval> | null = null;
  hostLeftEndsAt: number | null = null;
  readonly hostGraceMs = 90_000;

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
        return [];
      }

      if (!data.slides || !Array.isArray(data.slides)) {
        console.error("Invalid response from Google Slides API:", data);
        return [];
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

      console.log('slidesData', slidesData)

      return slidesData;
    } catch (error) {
      console.error("Error fetching slide content:", error);
      return [];
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
    const connections = Array.from(this.room.getConnections());
    this.room.broadcast(JSON.stringify({
      type: "user_count",
      count: connections.length
    }));
  }

  async resolveUserNameFromSessionToken(token: string) {
    const backendBaseUrl =
      (globalThis as unknown as { process?: { env?: Record<string, string> } }).process?.env
        ?.BACKEND_BASE_URL || "http://localhost:4002";

    try {
      const response = await fetch(`${backendBaseUrl}/api/party/session-user?roomId=${encodeURIComponent(this.room.id)}`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) return null;
      const data = await response.json() as { userId?: string; userName?: string; role?: "host" | "viewer" | null };
      return {
        userId: data.userId,
        userName: data.userName,
        role: data.role ?? undefined,
      };
    } catch (error) {
      console.error("Failed to resolve user from session token:", error);
      return null;
    }
  }

  getBackendBaseUrl() {
    return (
      (globalThis as unknown as { process?: { env?: Record<string, string> } }).process?.env
        ?.BACKEND_BASE_URL || "http://localhost:4002"
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

  getConnectionsWithState() {
    return Array.from(this.room.getConnections()).map((conn) => ({
      conn,
      state: (conn.state as { userId?: string; userName?: string; role?: "host" | "viewer"; token?: string } | null) ?? null,
    }));
  }

  hasConnectedHost() {
    return this.getConnectionsWithState().some(({ state }) => state?.role === "host");
  }

  broadcastHostTimerTick() {
    if (!this.hostLeftEndsAt) return;
    const remainingMs = Math.max(0, this.hostLeftEndsAt - Date.now());
    this.room.broadcast(
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
      this.room.broadcast(JSON.stringify({ type: "host_returned" }));
    }
  }

  async forceCloseRoom(reason: "no_participants" | "host_timeout") {
    const connectionWithToken = this.getConnectionsWithState().find(({ state }) => !!state?.token);
    if (connectionWithToken?.state?.token) {
      await this.closeRoomInBackend(connectionWithToken.state.token);
    }
    this.room.broadcast(JSON.stringify({ type: "room_closed", reason }));
    for (const connection of this.room.getConnections()) {
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
    this.room.broadcast(
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
    conn.setState({
      token,
      userId: userInfo?.userId,
      userName: userInfo?.userName || `User ${conn.id.slice(0, 4)}`,
      role: userInfo?.role || "viewer",
    });

    const sameUserConnections = this.getConnectionsWithState().filter(
      ({ state }) => state?.userId && state?.userId === userInfo?.userId
    );
    if (userInfo?.userId && sameUserConnections.length === 1) {
      await this.sendPresenceEvent(token, "connect");
    }

    console.log(`New connection to room ${this.room.id}`);
    conn.send(JSON.stringify({ type: "connected", message: `Welcome ${conn.id}` }));

    // Send current room state to new connection
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
    }

    // Broadcast updated user count
    this.broadcastUserCount();
    await this.updateRoomLifecycle();
  }

  async onClose(conn: Party.Connection) {
    console.log(`Connection ${conn.id} closed`);
    const state = (conn.state as { userId?: string; token?: string } | null) ?? null;
    const sameUserStillConnected = this.getConnectionsWithState().some(
      ({ state: connectedState }) =>
        !!state?.userId && connectedState?.userId === state.userId
    );
    if (state?.token && !sameUserStillConnected) {
      await this.sendPresenceEvent(state.token, "disconnect");
    }

    // Broadcast updated user count after disconnect
    this.broadcastUserCount();
    await this.updateRoomLifecycle();
  }

  async onMessage(message: string, sender: Party.Connection) {
    console.log(`connection ${sender.id} sent message ${message}`);
    try {
      const data = JSON.parse(message);
      console.log('data', data.type)

      if (data.type === "load_slide") {
        if (!data.presentationId) return;

        const slideContent = await this.getSlideContent(
          data.presentationId,
          data.token
        );

        if (slideContent.length === 0) {
          console.error("Failed to load slides - no content returned");
          sender.send(JSON.stringify({
            type: "error",
            message: "Failed to load presentation slides"
          }));
          return;
        }

        this.slides = slideContent;
        this.presentationId = data.presentationId;
        this.currentSlideIndex = 0;

        this.room.broadcast(
          JSON.stringify({
            type: "slide_content",
            slides: slideContent,
            presentationId: data.presentationId
          }),
        );
      } else if (data.type === "slide_change") {
        this.currentSlideIndex = data.slideIndex;
        this.room.broadcast(
          JSON.stringify({
            type: "slide_change",
            slideIndex: data.slideIndex,
          }),
          [sender.id]
        );
      } else if (data.type === "chat_message") {
        const state = sender.state as { userId?: string; userName?: string } | null;
        const userName = state?.userName || `User ${sender.id.slice(0, 4)}`;
        this.room.broadcast(
          JSON.stringify({
            type: "chat_message",
            id: `${sender.id}-${Date.now()}`,
            userId: state?.userId || sender.id,
            userName: userName,
            message: data.message,
            timestamp: Date.now()
          })
        );
      }
    } catch (error) {
      console.error("Error processing message:", error);
    }
  }
}
