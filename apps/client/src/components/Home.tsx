import Header from "./Header"
import HeroRoomPeek from "./HeroRoomPeek"
import { Link } from "@tanstack/react-router"
import { Globe, RefreshCw, Sparkles, BarChart3, FileText, KeyRound, ShieldCheck, MousePointer2 } from "lucide-react"
import type { LucideIcon } from "lucide-react"
import userAuth from "../utils/userSession"
import { useRef } from "react"
import type { MouseEvent as ReactMouseEvent, MouseEventHandler } from "react"
import gsap from "gsap"
import { useGSAP } from "@gsap/react"

const GLOW_REST_Y = 114

// The hero's headline features. Order matters: the two we lead on sit first.
const HERO_CHIPS: { label: string; Icon: LucideIcon }[] = [
    { label: "Quizzes written from your deck", Icon: Sparkles },
    { label: "Live polls with timers", Icon: BarChart3 },
    { label: "PDF, PowerPoint & Google Slides", Icon: FileText },
    { label: "Join with a five-character code", Icon: KeyRound },
    { label: "Mute, lock & approve joins", Icon: ShieldCheck },
    { label: "Shared laser pointer", Icon: MousePointer2 },
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

function FloatChip({ label, Icon, onMouseEnter, onMouseLeave }: {
    label: string
    Icon: LucideIcon
    onMouseEnter: MouseEventHandler<HTMLDivElement>
    onMouseLeave: MouseEventHandler<HTMLDivElement>
}) {
    return (
        <div className="float-chip relative will-change-transform" onMouseEnter={onMouseEnter} onMouseLeave={onMouseLeave}>
            {/* ripple pushed outward when the chip is pressed into the surface */}
            <span aria-hidden className="chip-ring pointer-events-none absolute -inset-px rounded-full border border-[#BB8856]/60 opacity-0"></span>
            {/* reflection on the water — widens and softens as the chip rises */}
            <span aria-hidden className="chip-shadow pointer-events-none absolute inset-x-4 -bottom-2.5 h-2 rounded-[50%] bg-[#BB8856]/25 dark:bg-black/50 blur-[6px]"></span>
            <div className="chip-body relative flex items-center gap-2 rounded-full border border-[#E7D9C7] dark:border-[#3A322B] bg-white/70 dark:bg-white/5 backdrop-blur px-4 py-2 text-xs sm:text-sm font-medium text-[#6B5D52] dark:text-[#C9BEB4] shadow-sm">
                <Icon className="w-4 h-4 shrink-0 text-[#BB8856]" />
                {label}
            </div>
        </div>
    )
}

export default function Home() {
    const { session } = userAuth()
    const ctaTo = session ? "/dashboard" : "/signup"
    const ctaText = session ? "Dashboard" : "Get Started Free"
    const heroRef = useRef<HTMLDivElement>(null)
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
        if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
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
    }, { scope: heroRef })

    // Hover presses the chip into the surface and pushes a ripple out from it.
    const handleChipEnter = contextSafe((event: ReactMouseEvent<HTMLDivElement>) => {
        if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
        const chip = event.currentTarget
        gsap.to(chip.querySelector(".chip-body"), { y: 4, scale: 0.98, duration: 0.3, ease: "power2.out" })
        gsap.fromTo(
            chip.querySelector(".chip-ring"),
            { scale: 0.9, opacity: 0.55 },
            { scale: 1.85, opacity: 0, duration: 0.85, ease: "power2.out" }
        )
    })

    const handleChipLeave = contextSafe((event: ReactMouseEvent<HTMLDivElement>) => {
        gsap.to(event.currentTarget.querySelector(".chip-body"), { y: 0, scale: 1, duration: 0.45, ease: "power2.out" })
    })

    return (
        <div className="min-h-screen bg-white dark:bg-[#0B0A09]">
            <Header />
            <div ref={heroRef} className="relative flex flex-col items-center justify-center min-h-[calc(100vh-80px)] px-6 pt-16 pb-24 bg-linear-to-b from-[#FDF8F1] via-[#FFFDFA] to-white dark:from-[#141210] dark:via-[#0F0D0B] dark:to-[#0B0A09] overflow-hidden">
                <div
                    ref={glowRef}
                    aria-hidden
                    className="pointer-events-none absolute left-0 top-0 w-[560px] max-w-full aspect-square rounded-full bg-[#BB8856]/10 dark:bg-[#BB8856]/20 blur-3xl will-change-transform"
                ></div>

                <div className="relative mb-8 max-w-3xl text-center">
                    <h1 className="text-6xl lg:text-8xl font-extrabold mb-5 text-[#BB8856] dark:text-[#D4A96A] tracking-tight">Presento</h1>
                    <p className="text-[#4A403A] dark:text-[#ECE7E2] text-2xl lg:text-4xl font-bold leading-tight tracking-tight">Where Teaching and Learning Come Together,</p>
                    <p className="text-[#998C8C] dark:text-[#9C918B] text-base lg:text-xl font-medium mt-3">Where instruction meets inspiration.</p>
                </div>


                <div className="relative flex gap-3 sm:gap-4 justify-center mb-12">
                    <Link to={ctaTo} className="bg-[#BB8856] hover:bg-[#A87744] text-white font-semibold text-sm sm:text-base px-6 py-3 sm:px-8 rounded-xl shadow-md transition-all duration-200 hover:shadow-lg hover:-translate-y-0.5">
                        {ctaText}
                    </Link>
                    <a href="#how-it-works" className="border border-[#BB8856]/40 hover:border-[#BB8856] text-[#BB8856] hover:bg-[#BB8856]/5 font-semibold text-sm sm:text-base px-6 py-3 sm:px-8 rounded-xl transition-all duration-200">
                        See How It Works
                    </a>
                </div>

                <div className="relative flex flex-wrap items-center justify-center gap-x-2.5 gap-y-5 sm:gap-x-3 sm:gap-y-6 max-w-3xl mb-14">
                    {HERO_CHIPS.map((chip) => (
                        <FloatChip
                            key={chip.label}
                            label={chip.label}
                            Icon={chip.Icon}
                            onMouseEnter={handleChipEnter}
                            onMouseLeave={handleChipLeave}
                        />
                    ))}
                </div>

                <HeroRoomPeek />
            </div>
            <div id="how-it-works" className="bg-[#0F0D0B] px-4 py-16 sm:px-8 sm:py-20 md:px-10 lg:px-16 lg:py-28">
                <div className="max-w-7xl mx-auto w-full">
                    <span className="text-[#D4A96A] text-xs font-semibold uppercase tracking-widest">How it works</span>
                    <h2 className="text-white text-3xl lg:text-5xl font-bold mt-3 mb-12 leading-tight">
                        Three Steps to a<br />Livelier Classroom
                    </h2>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-5">

                        <div className="bg-[#1A1714] rounded-2xl p-8 lg:p-10 ring-1 ring-white/5">
                            <span className="text-[#D4A96A] text-4xl font-bold">01</span>
                            <h3 className="text-white text-lg font-bold mt-4 mb-2">Pick Your Deck</h3>
                            <p className="text-[#888] text-sm leading-relaxed">Choose a Google Slides deck, PowerPoint, or PDF from your Drive. PowerPoint converts automatically — your slides look exactly as you made them.</p>
                        </div>


                        <div className="bg-[#C49A5A] rounded-2xl p-8 lg:p-10 ring-1 ring-black/5">
                            <span className="text-white text-4xl font-bold">02</span>
                            <h3 className="text-white text-lg font-bold mt-4 mb-2">Share a Room Code</h3>
                            <p className="text-[#f5e8d4] text-sm leading-relaxed">Share your five-character room code. Students open it in any browser — no downloads, no install.</p>
                        </div>

                        <div className="bg-[#1A1714] rounded-2xl p-8 lg:p-10 ring-1 ring-white/5">
                            <span className="text-[#D4A96A] text-4xl font-bold">03</span>
                            <h3 className="text-white text-lg font-bold mt-4 mb-2">Present Live</h3>
                            <p className="text-[#888] text-sm leading-relaxed">Students see your slides in real time. They react, respond, and stay engaged throughout.</p>
                        </div>
                    </div>
                </div>
            </div>
            <div id="why-presento" className="bg-[#FEF8F0] dark:bg-[#141210] px-4 py-16 sm:px-8 sm:py-20 md:px-10 lg:px-16 lg:py-28">
                <div className="max-w-7xl mx-auto w-full">
                    <span className="text-[#D4A96A] text-xs font-semibold uppercase tracking-widest">Why Presento</span>
                    <h2 className="text-black dark:text-white text-3xl lg:text-5xl font-bold mt-3 mb-12 leading-tight">
                        Everything a great
                        <br />lesson needs
                    </h2>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
                        {WHY_CARDS.map(({ title, body, Icon }) => (
                            <div key={title} className="bg-[#EFE3D0] dark:bg-[#1A1714] rounded-2xl p-8 ring-1 ring-black/5 dark:ring-white/5">
                                <div className="w-10 h-10 bg-[#C49A5A] rounded-lg mb-6 flex items-center justify-center">
                                    <Icon className="w-5 h-5 text-white" />
                                </div>
                                <h3 className="text-[#1A1714] dark:text-[#ECE7E2] text-base font-bold mb-2">{title}</h3>
                                <p className="text-[#7A6A5A] dark:text-[#9C918B] text-sm leading-relaxed">{body}</p>
                            </div>
                        ))}
                    </div>
                </div>
            </div>

            <div className="bg-[#0F0D0B] px-4 py-14 sm:px-8 md:px-10 lg:px-16 border-t border-white/5">
                <div className="max-w-7xl mx-auto w-full flex flex-col lg:flex-row lg:items-start lg:justify-between">
                    <div className="flex flex-col justify-between min-h-[160px]">
                        <div>
                            <h3 className="text-[#ECE7E2] text-xl md:text-3xl font-semibold tracking-[0.04em] mb-3">Presento</h3>
                            <p className="text-[#7D7A76] md:text-sm">Where teaching and learning come together.</p>
                        </div>
                        <p className="text-[#66635F] text-sm mt-8 lg:mt-0">© 2026 Presento. All rights reserved.</p>
                    </div>

                    <div className="flex gap-10 sm:gap-14 lg:gap-16 pt-6 md:pt-0">
                        <div>
                            <h4 className="text-[#B88A54] text-sm font-semibold mb-4">Quick Links</h4>
                            <div className="flex flex-col gap-2.5 text-sm">
                                <a href="#how-it-works" className="text-[#87837E] hover:text-[#EEE8E2] transition-colors">How It Works</a>
                                <a href="#why-presento" className="text-[#87837E] hover:text-[#EEE8E2] transition-colors">Why Presento</a>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    )
}
