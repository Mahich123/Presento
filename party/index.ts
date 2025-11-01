import type * as Party from "partykit/server";

export default class Server implements Party.Server {
  constructor(readonly room: Party.Room) {}
  async onRequest(request: Party.Request) {
    console.log('room id', this.room.id)
    console.log(`Hello from partykit room: ${this.room.id}`)
    if (request.method === "POST") {
    // Accept POST for room creation, return 200 OK
    return new Response(`Room ${this.room.id} created/connected via POST`, { status: 200 });
  }

  // Default GET response
  return new Response(`Hello from PartyKit room: ${this.room.id}`);
  }

  onConnect(conn: Party.Connection, ctx: Party.ConnectionContext) {
    console.log(`New connection ${this.room.id}`)

    this.room.broadcast(`Howdy! ${conn.id}`)
  }

  onMessage(message: string, sender: Party.Connection) {
    console.log(`connection ${sender.id} sent message ${message}`)
     try {
      const data = JSON.parse(message);
      
      if (data.type === 'text-change') {
        console.log(`Broadcasting text change from ${sender.id} to other users`);
        // Broadcast to all other connections (exclude sender)
        this.room.broadcast(
          JSON.stringify({
            type: 'text-change',
            content: data.content,
            delta: data.delta,
            senderId: sender.id
          }), 
          [sender.id]
        );
      }
    } catch (error) {
      console.log(`Non-JSON message from ${sender.id}:`, message);
      // Handle non-JSON messages
      this.room.broadcast(`${sender.id} says: ${message}`, [sender.id]);
    }
  }
}
