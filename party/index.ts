import type * as Party from "partykit/server";

export default class Server implements Party.Server {
  constructor(readonly room: Party.Room) {}

  async getSlideContent(presentationId: string, token: string) {
    try {
      const slidesData = []
      const res = await fetch(
        `https://slides.googleapis.com/v1/presentations/${presentationId}`,
        {
          headers: { Authorization: `Bearer ${token}` },
        }
      );

      const data = await res.json();

      // Fix: Remove the map() and just use forEach or a regular for loop
      data.slides.forEach((slide: any, i: number) => {
        const pageId = slide.objectId; // Use 'slide' not 'data.slides[i]'
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
      return []; // Return empty array on error
    }
}

  async onBeforeConnect(request: Party.Request) {
    try {
      const authHeader = request.headers.get("Authorization");
      const token = authHeader?.replace("Bearer ", "");

      if (!token) {
        return new Response("Unauthorized", { status: 401 });
      }

      const authRes = await fetch("http://localhost:3001/api/auth/session", {
        headers: {
          Authorization: `Bearer ${token}`,
          Cookie: `better-auth.session_token=${token}`,
        },
      });

      const session = await authRes.json();

      if (!session?.user) {
        return new Response("Unauthorized", { status: 401 });
      }

      console.log("request", request);

      return request;
    } catch (error) {
      console.error("Authentication failed:", error);
    }
  }

  async onRequest(request: Party.Request) {
    console.log("room id", this.room.id);
    console.log(`Hello from partykit room: ${this.room.id}`);
    if (request.method === "POST") {
      return new Response(`Room ${this.room.id} created/connected via POST`, {
        status: 200,
      });
    }

    return new Response(`Hello from PartyKit room: ${this.room.id}`);
  }

  onConnect(conn: Party.Connection, ctx: Party.ConnectionContext) {
    console.log(`New connection ${this.room.id}`);

    this.room.broadcast(`Howdy! ${conn.id}`);
  }

  async onMessage(message: string, sender: Party.Connection) {
    console.log(`connection ${sender.id} sent message ${message}`);
    try {
      const data = JSON.parse(message);

      if (data.type === "load_slide") {
        const slideContent = await this.getSlideContent(
          data.presentationId,
          data.token
        );

        console.log('slidecont',slideContent)

        this.room.broadcast(
          JSON.stringify({
            type: "slide_content",
            slides: slideContent,
          }),
        );
      } else if (data.type === "slide_change") {
        this.room.broadcast(
          JSON.stringify({
            type: "slide_change",
            slideIndex: data.slideIndex,
          }),
          [sender.id]
        );
      }
    } catch (error) {

      this.room.broadcast(`${sender.id} says: ${message}`, [sender.id]);
    }
  }
}
