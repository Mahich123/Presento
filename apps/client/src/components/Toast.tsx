type ToastVariant = "info" | "success" | "error"

interface ToastProps {
    message: string
    variant?: ToastVariant
    onClose?: () => void
}

// One stroke weight, one grid, three marks — the alert used the same X icon for
// a success as for a failure.
const MARK: Record<ToastVariant, { d: string; extra?: string; tint: string; edge: string }> = {
    info: {
        d: "M12 16v-4M12 8h.01",
        extra: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z",
        tint: "text-base-content/60",
        edge: "border-base-300",
    },
    success: {
        d: "m8 12.5 2.5 2.5L16 9.5",
        extra: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z",
        tint: "text-success",
        edge: "border-success/45",
    },
    error: {
        d: "M12 8v5M12 16.5h.01",
        extra: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z",
        tint: "text-error",
        edge: "border-error/45",
    },
}

export default function Toast({ message, variant = "info", onClose }: ToastProps) {
    const mark = MARK[variant]

    return (
        // Announced rather than only seen: these report the result of an action
        // the host just took, often while they are talking to a room.
        <div
            role="status"
            aria-live="polite"
            className="toast toast-center toast-top z-[9999] animate-fade-down"
        >
            <div
                className={`alert flex items-center gap-3 rounded-xl border ${mark.edge} bg-base-100 px-4 py-3 text-base-content shadow-lg`}
            >
                <svg
                    aria-hidden="true"
                    className={`size-[18px] shrink-0 ${mark.tint}`}
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                >
                    <path d={mark.extra} />
                    <path d={mark.d} />
                </svg>
                <span className="text-sm font-semibold">{message}</span>
                {onClose ? (
                    <button
                        type="button"
                        onClick={onClose}
                        aria-label="Dismiss"
                        className="-mr-1 ml-1 rounded-md p-1 text-base-content/50 transition-colors hover:bg-base-200 hover:text-base-content focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                    >
                        <svg
                            aria-hidden="true"
                            className="size-3.5"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth={2.5}
                            strokeLinecap="round"
                        >
                            <path d="M18 6 6 18M6 6l12 12" />
                        </svg>
                    </button>
                ) : null}
            </div>
        </div>
    )
}
