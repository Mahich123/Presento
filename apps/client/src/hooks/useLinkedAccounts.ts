import { useQuery } from "@tanstack/react-query";

import { client } from "../utils/honoClient";

/**
 * Which providers the signed-in user has linked. The header and the dashboard
 * both read it, and share one cached request.
 */
export function useLinkedAccounts(userId: string | undefined) {
    return useQuery({
        queryKey: ["accounts", userId],
        enabled: !!userId,
        // Linking finishes with an OAuth redirect, which reloads the page anyway.
        staleTime: Infinity,
        queryFn: async () => {
            const res = await client.api.accounts.$get();
            if (!res.ok) throw new Error(`Failed to load linked accounts (${res.status})`);
            return res.json();
        },
    });
}
