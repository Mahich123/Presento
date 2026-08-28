import Header from "./Header"
import HeroRoomPeek from "./HeroRoomPeek"
import { Link } from "@tanstack/react-router"
import { Globe, RefreshCw, Sparkles, BarChart3, FileText, KeyRound, ShieldCheck, MousePointer2, CreditCard, Eye } from "lucide-react"
import type { LucideIcon } from "lucide-react"
import userAuth from "../utils/userSession"
import { useRef } from "react"
import type { MouseEvent as ReactMouseEvent, MouseEventHandler } from "react"
import gsap from "gsap"
import { useGSAP } from "@gsap/react"

const GLOW_REST_Y = 114

// Three chips, not six: what Presento makes, what it accepts, how people get in.
// Everything cut from this list is stated in full further down the page, and each
// chip is a real link to the section that expands on it — the hover press promises
// a destination, so there has to be one.
const HERO_CHIPS: { label: string; Icon: LucideIcon; href: string }[] = [
    { label: "Quizzes written from your deck", Icon: Sparkles, href: "#why-presento" },
    { label: "PDF, PowerPoint & Google Slides", Icon: FileText, href: "#how-it-works" },
    { label: "Join with a five character code", Icon: KeyRound, href: "#how-it-works" },
]

const WHY_CARDS: { title: string; body: string; Icon: LucideIcon }[] = [
    {
        title: "AI Quizzes, No Subscription",
        body: "Presento writes questions straight from your slides using your own API key. The free OpenRouter option needs no card at all.",
        Icon: Sparkles,
    },
    {
        title: "Live Polls with Timers",
        body: "Push a question onto the slide and watch answers land in real time. The clock runs on the server, so nobody's laptop can cheat it.",
        Icon: BarChart3,
    },
    {
        title: "You Run the Room",
        body: "Mute anyone, lock the door so new arrivals need your approval, or switch chat off entirely when it stops helping.",
        Icon: ShieldCheck,
    },
    {
        title: "Point at Anything",
        body: "Turn on the laser and every student sees exactly where you're pointing, on their own screen.",
        Icon: MousePointer2,
    },
    {
        title: "Nobody Loses Their Place",
        body: "Dropped Wi-Fi doesn't mean starting over. Students rejoin on the slide you're actually on, with their mute state intact.",
        Icon: RefreshCw,
    },
    {
        title: "Nothing to Install",
        body: "Students join through the browser on whatever device they brought. No app, no download.",
        Icon: Globe,
    },
]

// The three facts a host weighs before granting Google access. Each is a durable
// property of how Presento is built, not a launch promotion — see PRODUCT.md.
const TRUST_FACTS: { title: string; body: string; Icon: LucideIcon }[] = [
    {
        title: "No card, no subscription",
        body: "A host can run a complete session, AI quiz generation included, without paying anything. There is no trial clock.",
        Icon: CreditCard,
    },
    {
        title: "Your API key stays in your browser",
        body: "It is sent to our server once per quiz, used for that single request, and never stored on it.",
        Icon: KeyRound,
    },
    {
        title: "Presento only reads your deck",
        body: "Google access is used to list and open the file you pick. Presento never edits, creates, or deletes anything in your Drive.",
        Icon: Eye,
    },
]

function FloatChip({ label, Icon, href, onMouseEnter, onMouseLeave }: {
    label: string
    Icon: LucideIcon
    href: string
    onMouseEnter: MouseEventHandler<HTMLAnchorElement>
    onMouseLeave: MouseEventHandler<HTMLAnchorElement>
}) {
    return (
        <a
            href={href}
            className="float-chip relative block rounded-full will-change-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#BB8856] focus-visible:ring-offset-2 focus-visible:ring-offset-[#FFFDFA] dark:focus-visible:ring-offset-[#0F0D0B]"
            onMouseEnter={onMouseEnter}
            onMouseLeave={onMouseLeave}
        >
            {/* ripple pushed outward when the chip is pressed into the surface */}
            <span aria-hidden className="chip-ring pointer-events-none absolute -inset-px rounded-full border border-[#BB8856]/60 opacity-0"></span>
            {/* reflection on the water — widens and softens as the chip rises */}
            {/* Warm bronze in dark too — pure black was invisible against the house,
                so the chips lost the grounding that makes them read as floating. */}
            <span aria-hidden className="chip-shadow pointer-events-none absolute inset-x-4 -bottom-2.5 h-2 rounded-[50%] bg-[#BB8856]/25 dark:bg-[#BB8856]/30 blur-[6px]"></span>
            <div className="chip-body relative flex items-center gap-2 rounded-full border border-[#E7D9C7] dark:border-[#3A322B] bg-white/70 dark:bg-white/5 backdrop-blur px-4 py-2 text-xs sm:text-sm font-medium text-[#6B5D52] dark:text-[#C9BEB4] shadow-sm">
                <Icon aria-hidden className="w-4 h-4 shrink-0 text-[#BB8856]" />
                {label}
            </div>
        </a>
    )
}

export default function Home() {
    const { session } = userAuth()
    const ctaTo = session ? "/dashboard" : "/signup"
    const ctaText = session ? "Dashboard" : "Get Started Free"
    const heroRef = useRef<HTMLElement>(null)
    const glowRef = useRef<HTMLDivElement>(null)

    const { contextSafe } = useGSAP(() => {
        const hero = heroRef.current
        const glow = glowRef.current
        if (!hero || !glow) return
        gsap.set(glow, {
            xPercent: -50,
            yPercent: -50,
            x: hero.offsetWidth / 2,
            y: GLOW_REST_Y,
        })
        // gsap.matchMedia re-evaluates when the OS preference changes and reverts what
        // it created. Reading matchMedia once at mount left everything animating for a
        // visitor who turned reduced motion on after the page had loaded.
        const mm = gsap.matchMedia()
        mm.add("(prefers-reduced-motion: no-preference)", () => {
            const moveX = gsap.quickTo(glow, "x", { duration: 0.6, ease: "power3.out" })
            const moveY = gsap.quickTo(glow, "y", { duration: 0.6, ease: "power3.out" })
            gsap.fromTo(
                glow,
                { scale: 0.86 },
                { scale: 1.14, duration: 2.2, ease: "sine.inOut", yoyo: true, repeat: -1 }
            )

            const handleMove = (event: MouseEvent) => {
                const rect = hero.getBoundingClientRect()
                moveX(event.clientX - rect.left)
                moveY(event.clientY - rect.top)
            }

            window.addEventListener("mousemove", handleMove, { passive: true })

            // Each chip bobs on its own phase (staggered start, per-index duration) so the
            // group never pulses in unison. The reflection widens as the chip rises — that
            // counter-motion is what reads as "floating" rather than "sliding up and down".
            gsap.to(".float-chip", {
                y: (i) => -(7 + (i % 3) * 2),
                rotation: (i) => (i % 2 === 0 ? 1.3 : -1.1),
                duration: (i) => 2.4 + (i % 4) * 0.3,
                ease: "sine.inOut",
                yoyo: true,
                repeat: -1,
                // Deterministic: chip i and shadow i must share a delay or they desync.
                stagger: 0.45,
            })
            gsap.to(".chip-shadow", {
                scaleX: 1.18,
                opacity: 0.35,
                duration: (i) => 2.4 + (i % 4) * 0.3,
                ease: "sine.inOut",
                yoyo: true,
                repeat: -1,
                // Deterministic: chip i and shadow i must share a delay or they desync.
                stagger: 0.45,
            })

            return () => window.removeEventListener("mousemove", handleMove)
        }, heroRef)

        return () => mm.revert()
    }, { scope: heroRef })

    // Hover presses the chip into the surface and pushes a ripple out from it.
    const handleChipEnter = contextSafe((event: ReactMouseEvent<HTMLAnchorElement>) => {
        if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
        const chip = event.currentTarget
        gsap.to(chip.querySelector(".chip-body"), { y: 4, scale: 0.98, duration: 0.3, ease: "power2.out" })
        gsap.fromTo(
            chip.querySelector(".chip-ring"),
            { scale: 0.9, opacity: 0.55 },
            { scale: 1.85, opacity: 0, duration: 0.85, ease: "power2.out" }
        )
    })

    const handleChipLeave = contextSafe((event: ReactMouseEvent<HTMLAnchorElement>) => {
        gsap.to(event.currentTarget.querySelector(".chip-body"), { y: 0, scale: 1, duration: 0.45, ease: "power2.out" })
    })

    return (
        <div className="min-h-screen bg-white dark:bg-[#0B0A09]">
            <Header />
            <main>
            {/* 65px, not 80 — that's what the sticky header actually measures, and the
                old value guaranteed the hero overflowed the first viewport by a sliver. */}
            <section ref={heroRef} className="relative flex flex-col items-center justify-center min-h-[calc(100vh-65px)] px-6 pt-16 pb-24 bg-linear-to-b from-[#FDF8F1] via-[#FFFDFA] to-white dark:from-[#141210] dark:via-[#0F0D0B] dark:to-[#0B0A09] overflow-hidden">
                <div
                    ref={glowRef}
                    aria-hidden
                    className="pointer-events-none absolute left-0 top-0 w-[560px] max-w-full aspect-square rounded-full bg-[#BB8856]/10 dark:bg-[#BB8856]/20 blur-3xl will-change-transform"
                ></div>

                <div className="relative mb-8 max-w-3xl text-center">
                    <h1 className="text-6xl lg:text-8xl font-extrabold mb-5 text-[#BB8856] dark:text-[#D4A96A] tracking-tight">Presento</h1>
                    <p className="text-[#4A403A] dark:text-[#ECE7E2] text-2xl lg:text-4xl font-bold leading-tight tracking-tight">Where Teaching and Learning Come Together,</p>
                    <p className="text-[#7A6A5A] dark:text-[#9C918B] text-base lg:text-xl font-medium mt-3">Where instruction meets inspiration.</p>
                </div>


                <div className="relative flex gap-3 sm:gap-4 justify-center mb-12">
                    <Link to={ctaTo} className="bg-[#96683A] hover:bg-[#7E5730] text-white font-semibold text-sm sm:text-base px-6 py-3 sm:px-8 rounded-xl shadow-md transition-all duration-200 hover:shadow-lg hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#BB8856] focus-visible:ring-offset-2 focus-visible:ring-offset-[#FFFDFA] dark:focus-visible:ring-offset-[#0F0D0B]">
                        {ctaText}
                    </Link>
                    <a href="#how-it-works" className="border border-[#96683A]/40 hover:border-[#96683A] text-[#96683A] hover:bg-[#96683A]/5 dark:border-[#D4A96A]/40 dark:hover:border-[#D4A96A] dark:text-[#D4A96A] dark:hover:bg-[#D4A96A]/10 font-semibold text-sm sm:text-base px-6 py-3 sm:px-8 rounded-xl transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#BB8856] focus-visible:ring-offset-2 focus-visible:ring-offset-[#FFFDFA] dark:focus-visible:ring-offset-[#0F0D0B]">
                        See How It Works
                    </a>
                </div>

                {/* The durable constraint from PRODUCT.md, stated where the decision is made.
                    Not a promotion — a host with no card can run a complete session. */}
                <p className="relative -mt-8 mb-12 text-center text-sm text-[#7A6A5A] dark:text-[#9C918B]">
                    Free to run a full session with AI quizzes included. No credit card, no subscription.
                </p>

                <div className="relative flex flex-wrap items-center justify-center gap-x-2.5 gap-y-5 sm:gap-x-3 sm:gap-y-6 max-w-3xl mb-14">
                    {HERO_CHIPS.map((chip) => (
                        <FloatChip
                            key={chip.label}
                            label={chip.label}
                            Icon={chip.Icon}
                            href={chip.href}
                            onMouseEnter={handleChipEnter}
                            onMouseLeave={handleChipLeave}
                        />
                    ))}
                </div>

                <HeroRoomPeek />
            </section>

            {/* Dark-theme band order is hero #0B0A09 → here #0F0D0B → why #0B0A09 →
                trust #141210 → closing #0B0A09 → footer #0F0D0B + hairline. Sections that
                hold #1A1714 cards stay darker than the cards so the cards still read. */}
            <section id="how-it-works" className="scroll-mt-20 bg-[#0F0D0B] px-4 py-16 sm:px-8 sm:py-20 md:px-10 lg:px-16 lg:py-28">
                <div className="max-w-7xl mx-auto w-full">
                    <span className="text-[#D4A96A] text-xs font-semibold uppercase tracking-widest">How it works</span>
                    <h2 className="text-white text-3xl lg:text-5xl font-bold mt-3 mb-12 leading-tight">
                        Three Steps to a<br />Livelier Classroom
                    </h2>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-5">

                        <div className="bg-[#1A1714] rounded-2xl p-8 lg:p-10 ring-1 ring-white/5">
                            <span className="text-[#D4A96A] text-4xl font-bold">01</span>
                            <h3 className="text-white text-lg font-bold mt-4 mb-2">Pick Your Deck</h3>
                            <p className="text-[#9C918B] text-sm leading-relaxed">Choose a Google Slides deck, PowerPoint, or PDF from your Drive. PowerPoint converts automatically your slides look exactly as you made them.</p>
                        </div>


                        <div className="bg-[#1A1714] rounded-2xl p-8 lg:p-10 ring-1 ring-white/5">
                            <span className="text-[#D4A96A] text-4xl font-bold">02</span>
                            <h3 className="text-white text-lg font-bold mt-4 mb-2">Share a Room Code</h3>
                            <p className="text-[#9C918B] text-sm leading-relaxed">Share your five character room code. Students open it in any browser no downloads, no install.</p>
                        </div>

                        <div className="bg-[#1A1714] rounded-2xl p-8 lg:p-10 ring-1 ring-white/5">
                            <span className="text-[#D4A96A] text-4xl font-bold">03</span>
                            <h3 className="text-white text-lg font-bold mt-4 mb-2">Present Live</h3>
                            <p className="text-[#9C918B] text-sm leading-relaxed">Students see your slides in real time. They react, respond, and stay engaged throughout.</p>
                        </div>
                    </div>
                </div>
            </section>

            <section id="why-presento" className="scroll-mt-20 bg-[#FEF8F0] dark:bg-[#0B0A09] px-4 py-16 sm:px-8 sm:py-20 md:px-10 lg:px-16 lg:py-28">
                <div className="max-w-7xl mx-auto w-full">
                    <span className="text-[#7A6A5A] dark:text-[#D4A96A] text-xs font-semibold uppercase tracking-widest">Why Presento</span>
                    <h2 className="text-[#1A1714] dark:text-[#ECE7E2] text-3xl lg:text-5xl font-bold mt-3 mb-12 leading-tight">
                        Everything a great
                        <br />lesson needs
                    </h2>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
                        {WHY_CARDS.map(({ title, body, Icon }) => (
                            <div key={title} className="bg-[#EFE3D0] dark:bg-[#1A1714] rounded-2xl p-8 ring-1 ring-black/5 dark:ring-white/5">
                                <div className="w-10 h-10 bg-[#96683A] rounded-lg mb-6 flex items-center justify-center">
                                    <Icon className="w-5 h-5 text-white" />
                                </div>
                                <h3 className="text-[#1A1714] dark:text-[#ECE7E2] text-base font-bold mb-2">{title}</h3>
                                <p className="text-[#4A403A] dark:text-[#9C918B] text-sm leading-relaxed">{body}</p>
                            </div>
                        ))}
                    </div>
                </div>
            </section>

            <section className="bg-[#FFFDFA] dark:bg-[#141210] px-4 py-14 sm:px-8 sm:py-16 md:px-10 lg:px-16 border-t border-[#E7D9C7] dark:border-[#3A322B]">
                <div className="max-w-7xl mx-auto w-full grid grid-cols-1 md:grid-cols-3 gap-8 md:gap-10">
                    {TRUST_FACTS.map(({ title, body, Icon }) => (
                        <div key={title} className="flex gap-3">
                            <Icon aria-hidden className="w-5 h-5 shrink-0 mt-0.5 text-[#96683A] dark:text-[#D4A96A]" />
                            <div>
                                <h3 className="text-[#1A1714] dark:text-[#ECE7E2] text-sm font-bold mb-1">{title}</h3>
                                <p className="text-[#4A403A] dark:text-[#9C918B] text-sm leading-relaxed">{body}</p>
                            </div>
                        </div>
                    ))}
                </div>
            </section>

            {/* The visitor who reached this point is the most persuaded person on the
                site. The page used to hand them nothing but two anchor links. */}
            <section className="bg-[#141210] dark:bg-[#0B0A09] px-4 py-20 sm:px-8 sm:py-24 md:px-10 lg:px-16">
                <div className="max-w-3xl mx-auto w-full text-center">
                    <h2 className="text-[#ECE7E2] text-3xl lg:text-4xl font-bold leading-tight">
                        Your next deck is already good.<br />Put a room around it.
                    </h2>
                    <div className="mt-8 flex justify-center">
                        <Link to={ctaTo} className="bg-[#96683A] hover:bg-[#7E5730] text-white font-semibold text-base px-8 py-3.5 rounded-xl shadow-md transition-all duration-200 hover:shadow-lg hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#D4A96A] focus-visible:ring-offset-2 focus-visible:ring-offset-[#141210]">
                            {ctaText}
                        </Link>
                    </div>
                    <p className="mt-5 text-sm text-[#9C918B]">
                        No card, no install — your students just need the room code.
                    </p>
                </div>
            </section>
            </main>

            <footer className="bg-[#0F0D0B] px-4 py-14 sm:px-8 md:px-10 lg:px-16 border-t border-[#3A322B]">
                <div className="max-w-7xl mx-auto w-full flex flex-col lg:flex-row lg:items-start lg:justify-between">
                    <div className="flex flex-col justify-between min-h-[160px]">
                        <div>
                            {/* The wordmark is branding, not a section heading — as an h3 it
                                put "Presento" back into the outline a second time. */}
                            <p className="text-[#ECE7E2] text-xl md:text-3xl font-semibold tracking-[0.04em] mb-3">Presento</p>
                            <p className="text-[#7D7A76] md:text-sm">Where teaching and learning come together.</p>
                        </div>
                        <p className="text-[#87837E] text-sm mt-8 lg:mt-0">© 2026 Presento. All rights reserved.</p>
                    </div>

                    <nav aria-label="Footer" className="pt-6 md:pt-0">
                        <h2 className="text-[#B88A54] text-sm font-semibold mb-2">Quick Links</h2>
                        {/* min-h-11 so these clear the 44px touch target on a phone —
                            they measured 20px tall. */}
                        <div className="flex flex-col text-sm">
                            <a href="#how-it-works" className="inline-flex items-center min-h-11 text-[#87837E] hover:text-[#EEE8E2] transition-colors rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#D4A96A] focus-visible:ring-offset-2 focus-visible:ring-offset-[#0F0D0B]">How It Works</a>
                            <a href="#why-presento" className="inline-flex items-center min-h-11 text-[#87837E] hover:text-[#EEE8E2] transition-colors rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#D4A96A] focus-visible:ring-offset-2 focus-visible:ring-offset-[#0F0D0B]">Why Presento</a>
                        </div>
                    </nav>
                </div>
            </footer>
        </div>
    )
}
