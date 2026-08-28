import { useTheme } from "../lib/useTheme"

export default function ThemeToggle() {
  const { theme, toggleTheme } = useTheme()

  // The visible track stays 56×32, but the button is padded out to a 44px touch
  // target — it measured 56×32 on a phone, under the minimum.
  return (
    <button
      onClick={toggleTheme}
      className="flex h-11 w-14 items-center justify-center rounded-full cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#BB8856] focus-visible:ring-offset-2 focus-visible:ring-offset-base-100"
      aria-label={`Switch to ${theme === "light" ? "dark" : "light"} mode`}
    >
      <span className="relative block h-8 w-14 rounded-full bg-[#E7D9C7] dark:bg-[#3A322B] transition-colors duration-300">
        <span
          className={`absolute left-1 top-1.5 text-[#96683A] transition-all duration-300 ${
            theme === "dark"
              ? "opacity-0 -translate-x-4 rotate-90 scale-0"
              : "opacity-100 translate-x-0 rotate-0 scale-100"
          }`}
        >
          <svg aria-hidden className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
            <path
              fillRule="evenodd"
              d="M10 2a1 1 0 011 1v1a1 1 0 11-2 0V3a1 1 0 011-1zm4 8a4 4 0 11-8 0 4 4 0 018 0zm-.464 4.95l.707.707a1 1 0 001.414-1.414l-.707-.707a1 1 0 00-1.414 1.414zm2.12-10.607a1 1 0 010 1.414l-.706.707a1 1 0 11-1.414-1.414l.707-.707a1 1 0 011.414 0zM17 11a1 1 0 100-2h-1a1 1 0 100 2h1zm-7 4a1 1 0 011 1v1a1 1 0 11-2 0v-1a1 1 0 011-1zM5.05 6.464A1 1 0 106.465 5.05l-.708-.707a1 1 0 00-1.414 1.414l.707.707zm1.414 8.486l-.707.707a1 1 0 01-1.414-1.414l.707-.707a1 1 0 011.414 1.414zM4 11a1 1 0 100-2H3a1 1 0 000 2h1z"
              clipRule="evenodd"
            />
          </svg>
        </span>

        <span
          className={`absolute right-1 top-1.5 text-[#D4A96A] transition-all duration-300 ${
            theme === "light"
              ? "opacity-0 translate-x-4 -rotate-90 scale-0"
              : "opacity-100 translate-x-0 rotate-0 scale-100"
          }`}
        >
          <svg aria-hidden className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
            <path d="M17.293 13.293A8 8 0 016.707 2.707a8.001 8.001 0 1010.586 10.586z" />
          </svg>
        </span>

        <span
          className={`absolute top-1 w-6 h-6 rounded-full bg-white dark:bg-[#ECE7E2] shadow-md transition-all duration-300 ${
            theme === "dark" ? "left-7" : "left-1"
          }`}
        />
      </span>
    </button>
  )
}
