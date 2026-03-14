import { createAuthClient } from "better-auth/react";

const baseURL = import.meta.env.VITE_BACKEND_BASE_URL || "http://localhost:4002";

export const authClient = createAuthClient({
  baseURL,
  fetchOptions: {
    credentials: "include",
  },
});
