import { app } from "./index";

const port = Number(process.env.PORT) || 4002;

Bun.serve({
  port,
  fetch(req) {
    return app.fetch(req, process.env);
  },
});

console.log(`Server running at http://localhost:${port}`);