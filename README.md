# Presento

Live, interactive presentations for teaching. A host opens a deck from Google Drive, shares a five-character room code, and students follow along in the browser. No app, no download, no install.

A projector shows slides one way. Presento makes them two-way: students answer polls and quizzes from their own device, follow the host's pointer on their own screen, and ask questions in chat without interrupting.

---

## Features

- **Present from Drive** : Google Slides, PowerPoint, or PDF. PowerPoint is converted by Google Drive, so slides look as they were made.
- **Live polls & quizzes** : Push a question onto the slide and watch answers land in real time. The countdown runs on the server, so no client can cheat it.
- **AI quiz generation** : Questions written from the deck's own text. Bring your own API key (Anthropic, OpenAI, or OpenRouter). The OpenRouter free tier needs no card. Keys are used for a single request and never stored.
- **Question sets** : Queue questions ahead of time and fire them one at a time.
- **Shared laser pointer** : Every student sees where the host is pointing, on their own screen.
- **Room control** : Mute individual participants, lock the room so new arrivals need approval, or switch chat off entirely.
- **Profanity filtering** : Enforced server-side on chat, not just hidden in the UI.
- **Reconnect where you left off** : A dropped connection rejoins on the current slide with mute state intact.
- **QR join** : Scan to join instead of typing the code.
- **Installable PWA**, light and dark themes.

## Getting started

Requires [Bun](https://bun.sh).

```sh
bun install
```

Create the `.env` files (see [Environment](#environment)), then run all three services:

```sh
bun run dev:all
```

Or individually:

```sh
bun run dev:backend    # Hono on :4002
bun run dev:frontend   # Vite on :5173
bun run dev:party      # PartyKit on :1999
```

Open http://localhost:5173.