import { authClient } from "../lib/auth-client"

export default function userAuth() {
    const {data: session, isPending} = authClient.useSession()

    const signOut = async () => {
       await authClient.signOut({
        fetchOptions: {
            onSuccess: () => {
                window.location.href = '/'
            }
        }
       })
    }
    return {
        session,
        isPending,
        signOut
    }
}