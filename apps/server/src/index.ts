import { Hono } from 'hono'
import { auth } from './lib/auth';
import { cors } from 'hono/cors'
import { env } from './lib/env';


const app = new Hono().basePath('/api')

.use(
	"*", 
	cors({
		origin: "http://localhost:5173",
		allowHeaders: ["Content-Type", "Authorization"],
		allowMethods: ["POST", "GET", "OPTIONS"],
		exposeHeaders: ["Content-Length"],
		credentials: true,
	}),
)
.get('/', (c) => {
  return c.text('Hello Hono!')
})
.on(["POST", "GET"], "/auth/*", (c) => {
	return auth.handler(c.req.raw);
})
.post('/party/:roomId', async (c) => {
  const roomId = c.req.param('roomId')

  const partyKitUrl = `${env.PARTYKIT_SERVER_URL}/parties/main/${roomId}`

  console.log('partykitUrl', partyKitUrl)

  const body = await c.req.text()

  const resp = await fetch(partyKitUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...c.req.header()
    },
    body: body
  })


  return new Response(await resp.text(), { status: resp.status });
})

console.log(`Server is running on port ${env.PORT}`);

export default{
	port: env.PORT,
	fetch: app.fetch
}

export type AppType = typeof app
export { app };

