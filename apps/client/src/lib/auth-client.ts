import { createAuthClient } from "better-auth/react";
export const authClient = createAuthClient({
  baseURL: "http://localhost:3001", // The base URL of your auth server
  fetchOptions: {
    credentials: "include",
  },
});
