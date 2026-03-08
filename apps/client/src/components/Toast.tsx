import CircleXIcon from "../icons/CandelIcon"

type ToastVariant = "info" | "success" | "error"

interface ToastProps {
    message: string
    variant?: ToastVariant
    onClose?: () => void
}

const variantClass: Record<ToastVariant, string> = {
    info: "alert-info",
    success: "alert-success",
    error: "alert-error",
}

export default function Toast({ message, variant = "info", onClose }: ToastProps) {
    return (
        <div className="toast toast-center toast-top z-[9999] animate-fade-down">
            <div
                className={`alert ${variantClass[variant]} bg-white border border-[#dbdbdb8c] flex items-center justify-center gap-3 animate-fade-down cursor-pointer`}
                onClick={onClose}
            >
                <CircleXIcon size={18}/>
                <span className="font-bold text-sm">{message}</span>
            </div>
        </div>
    )
}