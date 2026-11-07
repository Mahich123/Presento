import { useQuery } from "@tanstack/react-query";

import { client } from "../utils/honoClient";

export class GoogleTokenError extends Error {
    readonly status: number;

    constructor(status: number, message: string) {
        super(message);
        this.status = status;
    }
}

/**
 * The host's Google access token, for the Picker and for loading Slides. The
 * server refreshes it near its one-hour expiry, so it stays fresh for 50 minutes.
 */
export function useGoogleAccessToken(userId: string | undefined, enabled: boolean) {
    return useQuery({
        queryKey: ["google-token", userId],
        enabled: enabled && !!userId,
        staleTime: 50 * 60 * 1000,
        // A 401 means the refresh token is dead; retrying won't revive it.
        retry: false,
        queryFn: async () => {
            const res = await client.api.linkGoogle.$get();
            if (!res.ok) {
                throw new GoogleTokenError(res.status, `Failed to get a Google token (${res.status})`);
            }
            const { accessToken } = await res.json();
            return accessToken;
        },
    });
}

/** The refresh token itself was rejected, so only reconnecting Google helps. */
export function isGoogleExpired(error: unknown) {
    return error instanceof GoogleTokenError && error.status === 401;
}
