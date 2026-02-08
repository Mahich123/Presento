import { createAuthClient } from "better-auth/react";
export const authClient = createAuthClient({
  baseURL: `${import.meta.env.VITE_BACKEND_BASE_URL}`, // The base URL of your auth server
  fetchOptions: {
    credentials: "include",
  },
});
