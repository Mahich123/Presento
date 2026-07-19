import Header from "./Header"
import { Link } from "@tanstack/react-router"
import { Users, Globe, RefreshCw } from "lucide-react"
import userAuth from "../utils/userSession"
import { useRef } from "react"
import gsap from "gsap"
import { useGSAP } from "@gsap/react"

const GLOW_REST_Y = 114

export default function Home() {
    const { session } = userAuth()
    const ctaTo = session ? "/dashboard" : "/signup"
    const ctaText = session ? "Dashboard" : "Get Started Free"
    const heroRef = useRef<HTMLDivElement>(null)
    const glowRef = useRef<HTMLDivElement>(null)

    useGSAP(() => {
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
        return () => window.removeEventListener("mousemove", handleMove)
    }, { scope: heroRef })

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

                <div className="relative flex flex-wrap items-center justify-center gap-2.5 sm:gap-3 mb-14">
                    <div className="flex items-center gap-1.5 rounded-full border border-[#E7D9C7] dark:border-[#3A322B] bg-white/70 dark:bg-white/5 backdrop-blur px-4 py-2 text-xs sm:text-sm font-medium text-[#6B5D52] dark:text-[#C9BEB4] shadow-sm">
                        <svg className="w-4 h-4 text-[#BB8856]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                        Works with PDF & PowerPoint
                    </div>
                    <div className="flex items-center gap-1.5 rounded-full border border-[#E7D9C7] dark:border-[#3A322B] bg-white/70 dark:bg-white/5 backdrop-blur px-4 py-2 text-xs sm:text-sm font-medium text-[#6B5D52] dark:text-[#C9BEB4] shadow-sm">
                        <svg className="w-4 h-4 text-[#BB8856]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                        Real-time slide sync
                    </div>
                    <div className="flex items-center gap-1.5 rounded-full border border-[#E7D9C7] dark:border-[#3A322B] bg-white/70 dark:bg-white/5 backdrop-blur px-4 py-2 text-xs sm:text-sm font-medium text-[#6B5D52] dark:text-[#C9BEB4] shadow-sm">
                        <svg className="w-4 h-4 text-[#BB8856]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                        Students join with a room code
                    </div>
                </div>

                <div className="relative group w-full max-w-5xl">
                    <div className="pointer-events-none absolute inset-0 bg-linear-to-r from-[#BB8856] to-[#D4A574] rounded-2xl blur opacity-25 group-hover:opacity-40 transition duration-500"></div>
                    <img
                        src="/slideimg.jpg"
                        alt="Presentation slide"
                        className="relative w-full h-auto rounded-2xl shadow-2xl ring-1 ring-black/5 transition-transform duration-500 group-hover:scale-[1.02]"
                    />
                </div>
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
                            <h3 className="text-white text-lg font-bold mt-4 mb-2">Upload Your Slides</h3>
                            <p className="text-[#888] text-sm leading-relaxed">Import any PDF or PowerPoint. Presento keeps your slides exactly as you made them.</p>
                        </div>


                        <div className="bg-[#C49A5A] rounded-2xl p-8 lg:p-10 ring-1 ring-black/5">
                            <span className="text-white text-4xl font-bold">02</span>
                            <h3 className="text-white text-lg font-bold mt-4 mb-2">Share a Room Code</h3>
                            <p className="text-[#f5e8d4] text-sm leading-relaxed">Create an account, share a room code, students join with a single code, no downloads, no friction.</p>
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

                        <div className="bg-[#EFE3D0] dark:bg-[#1A1714] rounded-2xl p-8 ring-1 ring-black/5 dark:ring-white/5">
                            <div className="w-10 h-10 bg-[#C49A5A] rounded-lg mb-6 flex items-center justify-center">
                                <RefreshCw className="w-5 h-5 text-white" />
                            </div>
                            <h3 className="text-[#1A1714] dark:text-[#ECE7E2] text-base font-bold mb-2">Live Sync</h3>
                            <p className="text-[#7A6A5A] dark:text-[#9C918B] text-sm leading-relaxed">Every slide change you make is instantly visible to all students in the room, no refresh needed.</p>
                        </div>

                        <div className="bg-[#EFE3D0] dark:bg-[#1A1714] rounded-2xl p-8 ring-1 ring-black/5 dark:ring-white/5">
                            <div className="w-10 h-10 bg-[#C49A5A] rounded-lg mb-6 flex items-center justify-center">
                                <Users className="w-5 h-5 text-white" />
                            </div>
                            <h3 className="text-[#1A1714] dark:text-[#ECE7E2] text-base font-bold mb-2">Role-Based Views</h3>
                            <p className="text-[#7A6A5A] dark:text-[#9C918B] text-sm leading-relaxed">Teachers control the flow. Students follow along. Each side sees exactly what they need to.</p>
                        </div>
                        <div className="bg-[#EFE3D0] dark:bg-[#1A1714] rounded-2xl p-8 ring-1 ring-black/5 dark:ring-white/5">
                            <div className="w-10 h-10 bg-[#C49A5A] rounded-lg mb-6 flex items-center justify-center">
                                <Globe className="w-5 h-5 text-white" />
                            </div>
                            <h3 className="text-[#1A1714] dark:text-[#ECE7E2] text-base font-bold mb-2">No App Required</h3>
                            <p className="text-[#7A6A5A] dark:text-[#9C918B] text-sm leading-relaxed">Students join through the browser. Nothing to install.</p>
                        </div>
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

                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-10 sm:gap-14 lg:gap-16 pt-6 md:pt-0">
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
