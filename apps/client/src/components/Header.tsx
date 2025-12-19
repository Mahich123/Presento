import { useEffect, useState } from "react"
import { client } from "../utils/honoClient"
import userAuth from "../utils/userSession"
import GoogleIcon from "../icons/GoogleIcon"
import GithubIcon from "../icons/GithubIcon"

export default function Header() {

    const { session, signOut } = userAuth()

    const [accounts, setAccounts] = useState<{ providerId: string }[]>([])

    const handleSignOut = async () => {
        try {
            return await signOut()
        } catch (error) {
            console.error('Sign out error:', error)
        }
    }

    const linkedAccounts = async () => {
        const currentUserId = session?.user.id

        if (!currentUserId) {
            return "user not available"
        }

        const passUserId = await client.api.getallAccounts[':userId'].$get({
            param: { userId: currentUserId }
        })

        const data = await passUserId.json()
        setAccounts(data)
    }

    useEffect(() => {
        if (session?.user.id) {
            linkedAccounts()
        }
    }, [])


    return (
        <div className="navbar bg-base-100 shadow-sm md:px-42">
            <div className="flex-1">
                <a className="text-xl font-extrabold">Presento</a>
            </div>
            <div className="flex-none">
                {session ? (
                    <div className="dropdown dropdown-end">
                        <div tabIndex={0} role="button" className="btn btn-ghost btn-circle avatar">
                            <div className="w-10 rounded-full">
                                <img
                                    alt="User avatar"
                                    src={session?.user.image} />
                            </div>
                        </div>
                        <ul
                            className="menu menu-sm dropdown-content bg-base-100 rounded-box z-1 mt-3 w-52 p-2 shadow">
                            <li>
                                <a className="justify-between">
                                    Profile
                                    <span className="badge badge-outline">{session?.user.name}</span>
                                </a>
                            </li>
                            <li>
                                <a>
                                    Linked
                                    {accounts.length === 0 && <span className="text-xs text-gray-400">None</span>}
                                    <div className="flex items-center  justify-end gap-x-2 mt-1">
                                        {accounts.map((acc, idx) => (
                                            <span key={idx} className="inline-flex items-center ">
                                                {acc.providerId === 'github' && <GithubIcon size={24} />}
                                                {acc.providerId === 'google' && <GoogleIcon size={24} />}
                                            </span>
                                        ))}
                                    </div>
                                </a>
                            </li>
                            <li><a>Settings</a></li>
                            <li><button onClick={handleSignOut}>Logout</button></li>
                        </ul>
                    </div>
                ) : (
                    <a href="/signup">
                        <button className="bg-black hover:bg-gray-800 text-white font-bold py-3 px-8 rounded-lg transition-colors duration-300 cursor-pointer">
                            Get Started
                        </button>
                    </a>
                )}
            </div>
        </div>
    )
}