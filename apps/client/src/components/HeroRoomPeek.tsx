import { useRef } from "react"
import { Check, Radio } from "lucide-react"
import gsap from "gsap"
import { useGSAP } from "@gsap/react"

// A scaled-down replica of the host's presenter view (RoomContent + PollStage).
// Palette, radii and copy are kept in sync with the real room so the peek stays honest.
const POLL_OPTIONS = [
    { label: "Chloroplast", percent: 64, correct: true },
    { label: "Mitochondria", percent: 21, correct: false },
    { label: "Nucleus", percent: 15, correct: false },
]

const CHAT = [
    { name: "Aisha", time: "10:04", message: "can you go back one slide?" },
    { name: "Rahul", time: "10:05", message: "got it, thanks!" },
]

export default function HeroRoomPeek() {
    const rootRef = useRef<HTMLDivElement>(null)

    useGSAP(() => {
        gsap.set(".peek-poll", { autoAlpha: 0 })
        gsap.set(".peek-toast", { autoAlpha: 0, y: -8 })
        gsap.set(".peek-fill", { width: 0 })

        if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
            // No loop — settle on the frame that shows the most: the poll, resolved.
            gsap.set(".peek-poll", { autoAlpha: 1 })
            gsap.set(".peek-fill", { width: (i: number) => `${POLL_OPTIONS[i].percent}%` })
            gsap.set(".peek-timer-fill", { scaleX: 0 })
            return
        }

        // The laser drifts the whole time — it's the cue that a person is presenting.
        gsap.to(".peek-laser", {
            x: 34,
            y: -18,
            duration: 2.8,
            ease: "sine.inOut",
            yoyo: true,
            repeat: -1,
        })

        const tl = gsap.timeline({ repeat: -1, defaults: { ease: "power2.out" } })
        tl.to(".peek-toast", { autoAlpha: 1, y: 0, duration: 0.5 }, 0.9)
            .to(".peek-toast", { autoAlpha: 0, duration: 0.4 }, 3.6)
            .to(".peek-poll", { autoAlpha: 1, duration: 0.45 }, 4.4)
            .fromTo(".peek-poll-card", { scale: 0.96, y: 10 }, { scale: 1, y: 0, duration: 0.5 }, "<")
            .fromTo(".peek-timer-fill", { scaleX: 1 }, { scaleX: 0, duration: 3.6, ease: "none" }, "<")
            .to(".peek-fill", { width: (i: number) => `${POLL_OPTIONS[i].percent}%`, duration: 0.9, stagger: 0.1 }, "<0.5")
            .to(".peek-poll", { autoAlpha: 0, duration: 0.5 }, "+=1.4")
            .set(".peek-fill", { width: 0 })
            .to({}, { duration: 1.4 })
    }, { scope: rootRef })

    return (
        <div ref={rootRef} className="relative group w-full max-w-4xl" aria-label="A preview of a live Presento room">
            <div className="pointer-events-none absolute inset-0 bg-linear-to-r from-[#BB8856] to-[#D4A574] rounded-2xl blur opacity-25 group-hover:opacity-40 transition duration-500"></div>

            <div className="relative rounded-2xl overflow-hidden shadow-2xl ring-1 ring-black/10 dark:ring-white/10">
                <div className="flex h-[280px] sm:h-[360px] lg:h-[420px]">

                    {/* ── Slide stage ───────────────────────────────── */}
                    <div className="relative flex-1 flex flex-col bg-gray-900 min-w-0">
                        <div className="flex-1 relative flex items-center justify-center overflow-hidden p-4 sm:p-6">

                            <div className="absolute top-3 left-3 z-10 rounded-md bg-black/65 px-2.5 py-1 text-[10px] sm:text-xs text-white">
                                Room ID: <span className="font-semibold tracking-wide">XK4M9</span>
                            </div>

                            {/* the slide itself */}
                            <div className="w-full max-w-md aspect-video bg-white rounded-sm shadow-lg flex flex-col justify-center px-5 sm:px-8">
                                <p className="text-[9px] sm:text-[11px] font-semibold uppercase tracking-widest text-[#BB8856]">Biology · Unit 3</p>
                                <h4 className="text-sm sm:text-xl font-bold text-gray-900 mt-1 mb-2 sm:mb-3">Photosynthesis</h4>
                                <ul className="space-y-1 sm:space-y-1.5 text-[9px] sm:text-xs text-gray-600">
                                    <li>· Light energy → chemical energy</li>
                                    <li>· Happens inside the chloroplast</li>
                                    <li>· Produces glucose and oxygen</li>
                                </ul>
                            </div>

                            {/* host laser */}
                            <span aria-hidden className="peek-laser absolute left-[46%] top-[58%] w-3 h-3 rounded-full bg-red-500 shadow-[0_0_10px_4px_rgba(239,68,68,0.7)]"></span>

                            <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-10 flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[10px] font-medium shadow-md bg-red-500 text-white shadow-red-500/40">
                                <span className="w-2 h-2 rounded-full bg-white animate-pulse"></span>
                                Laser On
                            </div>

                            {/* join toast, exactly as the room renders it */}
                            <div className="peek-toast absolute top-3 left-1/2 -translate-x-1/2 z-30 bg-white text-gray-800 text-[10px] sm:text-xs px-3 py-2 rounded-xl shadow-lg border border-gray-100 whitespace-nowrap">
                                David joined the room
                            </div>

                            {/* ── Live poll, over the slide (PollStage) ── */}
                            <div className="peek-poll absolute inset-0 z-20 flex items-center justify-center bg-black/70 backdrop-blur-sm p-3 sm:p-6">
                                <div className="peek-poll-card w-full max-w-xs sm:max-w-sm bg-white rounded-2xl shadow-2xl overflow-hidden">
                                    <div className="h-1 w-full bg-gray-100">
                                        <div className="peek-timer-fill h-full origin-left bg-[#BB8856]"></div>
                                    </div>
                                    <div className="p-3 sm:p-5 space-y-3">
                                        <p className="text-[9px] sm:text-[11px] font-medium uppercase tracking-wide text-gray-400">Question 2 of 5</p>
                                        <div className="flex items-start justify-between gap-3">
                                            <h5 className="text-xs sm:text-base font-semibold text-gray-900 leading-snug">Where does photosynthesis happen?</h5>
                                            <span className="shrink-0 text-[10px] sm:text-sm font-semibold tabular-nums text-gray-400">18s</span>
                                        </div>
                                        <div className="space-y-1.5 sm:space-y-2">
                                            {POLL_OPTIONS.map((option) => (
                                                <div
                                                    key={option.label}
                                                    className={`relative w-full overflow-hidden rounded-xl border-2 px-2.5 sm:px-4 py-1.5 sm:py-2.5 text-left ${option.correct ? "border-green-500 bg-green-50" : "border-gray-200"}`}
                                                >
                                                    <span
                                                        aria-hidden
                                                        className="peek-fill absolute inset-y-0 left-0 w-0 pointer-events-none"
                                                        style={{ background: option.correct ? "rgba(34,197,94,0.16)" : "rgba(187,136,86,0.14)" }}
                                                    ></span>
                                                    <span className="relative flex items-center gap-2">
                                                        {option.correct && <Check className="size-3 shrink-0 text-green-600" strokeWidth={3} />}
                                                        <span className="flex-1 text-[10px] sm:text-sm text-gray-800">{option.label}</span>
                                                        <span className="shrink-0 text-[9px] sm:text-xs font-semibold tabular-nums text-gray-500">{option.percent}%</span>
                                                    </span>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div className="bg-gray-800 text-white text-center py-1.5 text-[10px] sm:text-xs shrink-0">Slide 12 of 24</div>
                    </div>

                    {/* ── Sidebar ───────────────────────────────────── */}
                    <div className="hidden md:flex w-60 lg:w-72 flex-col bg-white border-l border-gray-200 shrink-0">
                        <div className="flex items-center justify-between px-3 py-2.5 border-b border-gray-200 bg-gray-50 shrink-0">
                            <div className="flex items-center gap-1.5 text-[11px] text-gray-600">
                                <span className="w-2 h-2 bg-green-500 rounded-full"></span>
                                <span>24 users online</span>
                            </div>
                        </div>

                        <div className="flex border-b border-gray-200 shrink-0 text-[11px] font-medium">
                            <span className="flex-1 text-center px-2 py-2 border-b-2 border-[#BB8856] text-gray-900">Chat</span>
                            <span className="flex-1 flex items-center justify-center gap-1 px-2 py-2 border-b-2 border-transparent text-gray-500">
                                Question
                                <span className="w-1.5 h-1.5 rounded-full bg-red-500"></span>
                            </span>
                            <span className="flex-1 text-center px-2 py-2 border-b-2 border-transparent text-gray-500">Settings</span>
                        </div>

                        <div className="px-3 py-2 border-b border-gray-100 shrink-0">
                            <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-gray-50 border border-gray-200">
                                <Radio className="size-3 shrink-0 text-[#BB8856] animate-pulse" />
                                <span className="text-[10px] text-gray-600 font-medium">Question is live on the slide</span>
                            </div>
                        </div>

                        <div className="flex-1 overflow-hidden p-3 space-y-2.5">
                            {CHAT.map((msg) => (
                                <div key={msg.name} className="flex flex-col">
                                    <div className="flex items-center gap-2">
                                        <span className="font-medium text-[11px] text-gray-800">{msg.name}</span>
                                        <span className="text-[10px] text-gray-400">{msg.time}</span>
                                    </div>
                                    <p className="text-[11px] text-gray-600">{msg.message}</p>
                                </div>
                            ))}
                        </div>

                        <div className="p-2 border-t border-gray-200 shrink-0">
                            <div className="flex gap-1.5 items-center">
                                <div className="flex-1 min-w-0 rounded-lg border border-gray-300 px-2.5 py-1.5 text-[11px] text-gray-400">Type a message...</div>
                                <div className="shrink-0 rounded-lg bg-[#BB8856] text-white text-[10px] font-medium px-2.5 py-1.5">Send</div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    )
}
