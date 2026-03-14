import { createAuthClient } from "better-auth/react";

const fallbackBaseUrl = import.meta.env.VITE_BACKEND_BASE_URL || "http://localhost:4002";
const baseURL =
  import.meta.env.VITE_BACKEND_BASE_URL ||
  (typeof window !== "undefined" ? window.location.origin : fallbackBaseUrl);

export const authClient = createAuthClient({
  baseURL,
  fetchOptions: {
    credentials: "include",
  },
});
