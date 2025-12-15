import { useNavigate } from "@tanstack/react-router"
import { authClient } from "../lib/auth-client"
import userAuth from "../utils/userSession"

function Signup() {

    const { session, isPending } = userAuth()
    const navigate = useNavigate()
    
    if (session && !isPending) {
        navigate({ to: "/dashboard" })
        return null
    }

    const handleGithubAuth = async () => {
        try {
            const res = await authClient.signIn.social({
                provider: 'github',
                callbackURL: import.meta.env.VITE_CLIENT_URL + '/dashboard'
            })
            console.log('res', res)
        } catch (error) {
            console.error('Github Sign in error:', error);
        }
    }

    const handleGoogleAuth = async () => {
        try {
            const res = await authClient.signIn.social({
                provider: 'google',
                callbackURL: import.meta.env.VITE_CLIENT_URL + '/dashboard'
            })
            console.log('res', res)
        } catch (error) {
            console.error('Google Sign in error:', error);
        }
    }



    return (
        <div className="flex flex-col items-center justify-center min-h-screen">
            <div>
                <h1 className="font-bold text-5xl">Presento</h1>
                <h3 className="mt-3 font-semibold text-[#919191]">Get Ready with just one click</h3>
                <div className="divider w-1/2"></div>
                <div className="mt-10 flex gap-4 items-center justify-center bg-[#dedede8f] p-4 rounded-md">
                    <div>
                        <button className="btn btn-lg" onClick={handleGoogleAuth}>Google</button>
                    </div>
                    <div>
                        <button className="btn btn-lg" onClick={handleGithubAuth}>Github</button>
                    </div>
                </div>
            </div>
        </div>
    )
}
export default Signup