import type * as Party from "partykit/server";

export default class Server implements Party.Server {
  slides: { pageNumber: number; imageUrl: string; pageId: string }[] = [];
  presentationId: string | null = null;
  currentSlideIndex: number = 0;

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

  onConnect(conn: Party.Connection, ctx: Party.ConnectionContext) {
    const token = new URL(ctx.request.url).searchParams.get("token");

    if (!token) {
      conn.close(4001, "Unauthorized");
      return;
    }

    conn.setState({ token, userName: `User ${conn.id.slice(0, 4)}` });

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
  }

  onClose(conn: Party.Connection) {
    console.log(`Connection ${conn.id} closed`);
    // Broadcast updated user count after disconnect
    this.broadcastUserCount();
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
        const state = sender.state as { userName?: string } | null;
        const userName = state?.userName || `User ${sender.id.slice(0, 4)}`;
        this.room.broadcast(
          JSON.stringify({
            type: "chat_message",
            id: `${sender.id}-${Date.now()}`,
            userId: sender.id,
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
