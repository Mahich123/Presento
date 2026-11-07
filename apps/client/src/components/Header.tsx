import { Link, useLocation } from "@tanstack/react-router"
import { useLinkedAccounts } from "../hooks/useLinkedAccounts"
import userAuth from "../utils/userSession"
import GoogleIcon from "../icons/GoogleIcon"
import GithubIcon from "../icons/GithubIcon"
import ThemeToggle from "./ThemeToggle"

export default function Header() {

    const { session, signOut } = userAuth()

    // On /signup the CTA would point at the page you're already on, so the header
    // there is just the way back plus the theme toggle.
    const onSignupPage = useLocation({ select: (location) => location.pathname === "/signup" })

    const { data: accounts = [] } = useLinkedAccounts(session?.user.id)

    const handleSignOut = async () => {
        try {
            return await signOut()
        } catch (error) {
            console.error('Sign out error:', error)
        }
    }


    return (
        <header className="sticky top-0 z-20 navbar bg-base-100 px-4 sm:px-8 lg:px-16 border-b border-base-300">
            <div className="flex-1 min-w-0">
                <Link to="/" className="inline-flex items-center min-h-11 px-1 -mx-1 text-xl font-extrabold rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#BB8856] focus-visible:ring-offset-2 focus-visible:ring-offset-base-100">Presento</Link>
            </div>
            {/* shrink-0 + min-w-0 above: the right cluster used to push 24px of
                horizontal overflow at 320px instead of letting the wordmark give way. */}
            <div className="flex-none shrink-0 flex items-center gap-2 sm:gap-3">
                <ThemeToggle />
                {session ? (
                    <div className="dropdown dropdown-end">
                        <div
                            tabIndex={0}
                            role="button"
                            aria-label="Account menu"
                            className="btn btn-ghost btn-circle avatar"
                        >
                            <div className="w-10 rounded-full ring-1 ring-base-300">
                                {session.user.image ? (
                                    <img alt="" src={session.user.image} />
                                ) : (
                                    <span className="flex h-full w-full items-center justify-center bg-base-200 text-sm font-bold text-base-content/70">
                                        {(session.user.name ?? '?').trim().charAt(0).toUpperCase()}
                                    </span>
                                )}
                            </div>
                        </div>
                        <ul
                            className="menu menu-sm dropdown-content bg-base-100 rounded-box z-1 mt-3 w-64 p-2 shadow-lg border border-base-300">
                            <li className="menu-title px-3 pt-1 pb-2">
                                <span className="block text-[0.7rem] font-normal opacity-60">Signed in as</span>
                                <span
                                    className="block text-sm font-medium text-base-content truncate"
                                    title={session?.user.name ?? undefined}
                                >
                                    {session?.user.name}
                                </span>
                            </li>
                            <li className="pointer-events-none px-3 py-2">
                                <div className="flex items-center justify-between gap-3 hover:bg-transparent">
                                    <span className="text-base-content/60">Linked accounts</span>
                                    {accounts.length === 0 ? (
                                        <span className="text-base-content/40">None</span>
                                    ) : (
                                        <span className="flex items-center gap-x-2">
                                            {accounts.map((acc) => (
                                                <span key={acc.id} className="inline-flex items-center">
                                                    {acc.providerId === 'github' && <GithubIcon size={20} />}
                                                    {acc.providerId === 'google' && <GoogleIcon size={20} />}
                                                </span>
                                            ))}
                                        </span>
                                    )}
                                </div>
                            </li>
                            <li className="mt-1 border-t border-base-300 pt-1">
                                <button onClick={handleSignOut}>Sign out</button>
                            </li>
                        </ul>
                    </div>
                ) : onSignupPage ? null : (
                    <Link
                        to="/signup"
                        className="bg-[#96683A] hover:bg-[#7E5730] text-white font-bold py-3 px-8 rounded-lg transition-colors duration-300 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#BB8856] focus-visible:ring-offset-2 focus-visible:ring-offset-base-100"
                    >
                        Get Started
                    </Link>
                )}
            </div>
        </header>
    )
}
