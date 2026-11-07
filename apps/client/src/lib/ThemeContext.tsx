import { useEffect, useMemo, useState } from "react"

import { ThemeContext, type Theme } from "./theme-context"

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useState<Theme>(() => {
    if (typeof window !== "undefined") {
      const stored = localStorage.getItem("theme") as Theme | null
      if (stored) return stored
      return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"
    }
    return "light"
  })

  useEffect(() => {
    const root = document.documentElement
    if (theme === "dark") {
      root.classList.add("dark")
      root.setAttribute("data-theme", "dark")
    } else {
      root.classList.remove("dark")
      root.setAttribute("data-theme", "light")
    }
    localStorage.setItem("theme", theme)
  }, [theme])

  // Built once per theme, so readers only redraw when the theme actually changes.
  const value = useMemo(() => ({
    theme,
    toggleTheme: () => setTheme((prev) => (prev === "light" ? "dark" : "light")),
  }), [theme])

  return (
    <ThemeContext.Provider value={value}>
      {children}
    </ThemeContext.Provider>
  )
}
