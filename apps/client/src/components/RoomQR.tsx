import { useEffect, useRef, useState } from "react"
import gsap from "gsap"
import { useGSAP } from "@gsap/react"
import { QRCodeSVG } from "qrcode.react"
import { X } from "lucide-react"

type Tone = "light" | "theme"

const TRIGGER_TONE: Record<Tone, { border: string; title: string; hint: string }> = {
  light: { border: "border-gray-200", title: "text-gray-800", hint: "text-gray-400" },
  theme: { border: "border-base-300", title: "text-base-content", hint: "text-base-content/70" },
}

const prefersReducedMotion = () =>
  window.matchMedia("(prefers-reduced-motion: reduce)").matches

export default function RoomQR({ roomId, tone = "light" }: { roomId: string; tone?: Tone }) {
  const [projecting, setProjecting] = useState(false)
  const overlayRef = useRef<HTMLDivElement>(null)
  const cardRef = useRef<HTMLDivElement>(null)

  const closingRef = useRef(false)
  const palette = TRIGGER_TONE[tone]

  const joinUrl = `${window.location.origin}/dashboard?roomId=${encodeURIComponent(roomId)}`

  const { contextSafe } = useGSAP(
    () => {
      if (!projecting || prefersReducedMotion()) return
      gsap.fromTo(
        overlayRef.current,
        { opacity: 0 },
        { opacity: 1, duration: 0.25, ease: "power2.out" }
      )
  
      gsap.fromTo(
        cardRef.current,
        { opacity: 0, scale: 0.92, y: 14 },
        { opacity: 1, scale: 1, y: 0, duration: 0.4, ease: "back.out(1.4)" }
      )
    },
    { dependencies: [projecting] }
  )

  const closeProjector = contextSafe(() => {
    if (closingRef.current) return
    if (prefersReducedMotion()) {
      setProjecting(false)
      return
    }
    closingRef.current = true
    gsap.to(cardRef.current, {
      opacity: 0,
      scale: 0.95,
      y: 8,
      duration: 0.18,
      ease: "power2.in",
    })
    gsap.to(overlayRef.current, {
      opacity: 0,
      duration: 0.22,
      ease: "power2.in",
      onComplete: () => {
        closingRef.current = false
        setProjecting(false)
      },
    })
  })

  useEffect(() => {
    if (!projecting) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeProjector()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [projecting, closeProjector])

  return (
    <>
      <button
        onClick={() => setProjecting(true)}
        className={`mt-2 w-full flex items-center gap-3 px-3 py-2.5 rounded-lg border ${palette.border} hover:border-[#BB8856] hover:bg-[#BB8856]/5 transition-colors cursor-pointer text-left`}
      >
        <span className="shrink-0 bg-white p-1 rounded">
          <QRCodeSVG value={joinUrl} size={56} level="M" />
        </span>
        <span className="min-w-0">
          <span className={`block text-sm ${palette.title}`}>Scan to join</span>
          <span className={`block text-xs ${palette.hint}`}>Tap to enlarge</span>
        </span>
      </button>
      {projecting && (
        <div
          ref={overlayRef}
          role="dialog"
          aria-modal="true"
          aria-label="Room join code"
          onClick={closeProjector}
          className="fixed inset-0 z-200 flex items-center justify-center overflow-auto bg-black/85 p-3"
        >
          <button
            onClick={closeProjector}
            aria-label="Close"
            className="absolute top-2 right-2 p-2 rounded-full text-white/70 hover:text-white hover:bg-white/10 cursor-pointer"
          >
            <X className="size-5" />
          </button>

          <div
            ref={cardRef}
            onClick={(e) => e.stopPropagation()}
            className="bg-white rounded-2xl px-4 py-6 text-center w-full max-w-full max-h-full overflow-y-auto"
          >
            <p className="text-xs font-semibold uppercase tracking-widest text-[#BB8856]">
              Scan to join
            </p>

            <div className="my-4 flex justify-center">
              <QRCodeSVG value={joinUrl} level="M" className="w-full max-w-60 h-auto" />
            </div>
            <p className="text-xs text-gray-500 mb-1">or enter this code</p>
            <p className="font-mono font-bold tracking-[0.2em] text-2xl text-gray-900 break-all">
              {roomId}
            </p>
          </div>
        </div>
      )}
    </>
  )
}
