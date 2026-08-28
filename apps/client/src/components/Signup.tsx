import { useState } from "react"
import { useNavigate } from "@tanstack/react-router"
import { authClient } from "../lib/auth-client"
import userAuth from "../utils/userSession"
import Header from "./Header"
import GoogleIcon from "../icons/GoogleIcon"
import GithubIcon from "../icons/GithubIcon"

type Provider = "google" | "github"

// A label swap alone doesn't read as "something is happening" on a slow network.
// Guarded for reduced motion, like every other animation in the product.
function Spinner() {
    return (
        <span
            aria-hidden="true"
            className="size-[18px] shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent motion-reduce:animate-none"
        />
    )
}

// Shape, height, and focus treatment are identical for both providers; only the
// fill differs. Hover states hang off `enabled:` so the pressed button doesn't
// keep reacting to the pointer while the redirect is in flight.
const BUTTON_BASE =
    "flex h-13 w-full cursor-pointer items-center justify-center gap-2.5 rounded-xl text-base font-semibold transition-[background-color,border-color,box-shadow,transform] duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#BB8856] focus-visible:ring-offset-2 focus-visible:ring-offset-[#FFFDFA] dark:focus-visible:ring-offset-[#141210]"

function Signup() {

    const { session, isPending } = userAuth()
    const navigate = useNavigate()
    const [error, setError] = useState<string | null>(null)
    const [pending, setPending] = useState<Provider | null>(null)
    const roomId = new URLSearchParams(window.location.search).get('roomId')?.trim() ?? ''
    if (session && !isPending) {
        navigate(roomId ? { to: "/dashboard", search: { roomId } } : { to: "/dashboard" })
        return null
    }

    const callbackURL = roomId
        ? `${window.location.origin}/dashboard?roomId=${encodeURIComponent(roomId)}`
        : `${window.location.origin}/dashboard`

    // A failed hand-off used to disappear into console.error, leaving the visitor
    // on a screen with nothing to read and nothing to press.
    const handleAuth = async (provider: Provider) => {
        setError(null)
        setPending(provider)
        try {
            await authClient.signIn.social({ provider, callbackURL })
        } catch (err) {
            console.error(`${provider} Sign in error:`, err)
            setError(
                `We couldn't reach ${provider === "google" ? "Google" : "GitHub"} just now. Check your connection and try again.`
            )
            setPending(null)
        }
    }

    const busy = pending !== null

    return (
        <div className="min-h-screen bg-[#FDF8F1] dark:bg-[#0B0A09]">
            <Header />
            <div className="flex min-h-[calc(100dvh-80px)] flex-col items-center justify-center px-6 py-12 sm:py-16">
                <div className="w-full max-w-md">
                    {/* The header already carries the wordmark. Repeating it here spent the
                        page's one big heading on the brand instead of on the visitor's job. */}
                    <div className="text-center">
                        <h1 className="text-3xl font-bold tracking-tight text-[#1A1714] dark:text-[#ECE7E2] sm:text-4xl">
                            {roomId ? "Sign in to join" : "Sign in to host a room"}
                        </h1>
                        {roomId ? (
                            <div className="mt-5 inline-flex flex-col items-center gap-1.5 rounded-xl bg-[#EFE3D0] dark:bg-[#1A1714] px-6 py-3">
                                <span className="text-xs font-semibold uppercase tracking-[0.1em] text-[#7A6A5A] dark:text-[#9C918B]">
                                    Room
                                </span>
                                <span className="font-mono text-2xl font-bold tracking-[0.2em] text-[#96683A] dark:text-[#D4A96A]">
                                    {roomId}
                                </span>
                            </div>
                        ) : (
                            <p className="mt-3 text-[#7A6A5A] dark:text-[#9C918B]">It takes one click.</p>
                        )}
                    </div>

                    <div className="mt-8 rounded-2xl bg-[#FFFDFA] dark:bg-[#141210] p-6 ring-1 ring-[#E7D9C7] dark:ring-[#3A322B] sm:p-8">
                        {error && (
                            <div role="alert" className="mb-5 rounded-xl bg-[#B4483C]/10 px-4 py-3 text-sm leading-relaxed text-[#8E3428] ring-1 ring-[#B4483C]/30 dark:text-[#F0A79C]">
                                {error}
                            </div>
                        )}

                        {/* Not two equal doors. Hosting a room needs a linked Google account to
                            pick a deck, so Google leads and GitHub is the quieter alternative —
                            the buttons should say that before the visitor finds out later. */}
                        <div className="flex flex-col gap-3">
                            <button
                                onClick={() => handleAuth("google")}
                                disabled={busy}
                                aria-busy={pending === "google"}
                                className={`${BUTTON_BASE} bg-[#96683A] text-white shadow-[0_4px_6px_-1px_rgba(0,0,0,0.1)] enabled:hover:-translate-y-0.5 enabled:hover:bg-[#7E5730] enabled:hover:shadow-[0_10px_15px_-3px_rgba(0,0,0,0.1)] motion-reduce:enabled:hover:translate-y-0 ${
                                    pending === "google" ? "cursor-wait" : busy ? "cursor-not-allowed opacity-50" : ""
                                }`}
                            >
                                {pending === "google" ? <Spinner /> : <GoogleIcon size={18} className="fill-current" />}
                                {pending === "google" ? "Opening Google…" : "Continue with Google"}
                            </button>

                            <button
                                onClick={() => handleAuth("github")}
                                disabled={busy}
                                aria-busy={pending === "github"}
                                className={`${BUTTON_BASE} border border-[#E7D9C7] text-[#4A403A] enabled:hover:border-[#DCC3A9] enabled:hover:bg-[#F6EDE0] dark:border-[#3A322B] dark:text-[#C9BEB4] dark:enabled:hover:border-[#4A403A] dark:enabled:hover:bg-[#1A1714] ${
                                    pending === "github" ? "cursor-wait" : busy ? "cursor-not-allowed opacity-50" : ""
                                }`}
                            >
                                {pending === "github" ? <Spinner /> : <GithubIcon size={18} className="fill-current" />}
                                {pending === "github" ? "Opening GitHub…" : "Continue with GitHub"}
                            </button>
                        </div>

                    </div>

                    {/* Google's consent screen is the highest-stakes moment on the site.
                        Saying what the grant is for belongs before it, not after — but it is
                        something to read, not something to press, so it sits outside the card
                        that holds the actions. Outlined rather than filled: a step down in
                        weight from the panel above it. */}
                    <div className="mt-5 rounded-2xl p-5 ring-1 ring-[#E7D9C7] dark:ring-[#3A322B] sm:p-6">
                        <p className="text-xs font-semibold uppercase tracking-[0.1em] text-[#7A6A5A] dark:text-[#9C918B]">
                            Before you continue
                        </p>
                        <dl className="mt-3 space-y-3 text-sm leading-relaxed">
                            <div>
                                <dt className="font-semibold text-[#1A1714] dark:text-[#ECE7E2]">Google asks for your Drive.</dt>
                                <dd className="text-[#7A6A5A] dark:text-[#9C918B]">
                                    Presento uses it to list your files and open the one deck you pick. It never
                                    edits, creates, or deletes anything.
                                </dd>
                            </div>
                            <div>
                                <dt className="font-semibold text-[#1A1714] dark:text-[#ECE7E2]">GitHub asks for less.</dt>
                                <dd className="text-[#7A6A5A] dark:text-[#9C918B]">
                                    {roomId
                                        ? "Just your name and email. Either one gets you into the room."
                                        : "But presenting a Drive deck needs Google connected, so you'd link it later anyway."}
                                </dd>
                            </div>
                        </dl>
                    </div>

                    <p className="mt-6 text-center text-sm leading-relaxed text-[#7A6A5A] dark:text-[#9C918B]">
                        Free to run a full session with AI quizzes included. No credit card, no subscription.
                    </p>
                </div>
            </div>
        </div>
    )
}
export default Signup
