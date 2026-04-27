"use client";

import { createContext, useContext, useState, useEffect, useCallback } from "react";

type ThemeChoice = "light" | "dark" | "system";
type EffectiveTheme = "light" | "dark";

interface ThemeContextType {
  theme: ThemeChoice;
  effectiveTheme: EffectiveTheme;
  setTheme: (t: ThemeChoice) => void;
  cycleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextType>({
  theme: "system",
  effectiveTheme: "dark",
  setTheme: () => {},
  cycleTheme: () => {},
});

export const useTheme = () => useContext(ThemeContext);

function resolveEffective(choice: ThemeChoice): EffectiveTheme {
  if (choice !== "system") return choice;
  if (typeof window === "undefined") return "dark";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

const CYCLE: ThemeChoice[] = ["dark", "light", "system"];

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<ThemeChoice>("system");
  const [effectiveTheme, setEffectiveTheme] = useState<EffectiveTheme>("dark");

  // Read stored preference on mount
  useEffect(() => {
    const stored = localStorage.getItem("pakad-theme") as ThemeChoice | null;
    if (stored && CYCLE.includes(stored)) {
      setThemeState(stored);
    }
  }, []);

  // Apply effective theme to <html> and listen for system changes
  useEffect(() => {
    const apply = () => {
      const eff = resolveEffective(theme);
      setEffectiveTheme(eff);
      document.documentElement.setAttribute("data-theme", eff);
    };
    apply();

    if (theme === "system") {
      const mq = window.matchMedia("(prefers-color-scheme: dark)");
      mq.addEventListener("change", apply);
      return () => mq.removeEventListener("change", apply);
    }
  }, [theme]);

  const setTheme = useCallback((t: ThemeChoice) => {
    setThemeState(t);
    localStorage.setItem("pakad-theme", t);
  }, []);

  const cycleTheme = useCallback(() => {
    setThemeState((prev) => {
      const next = CYCLE[(CYCLE.indexOf(prev) + 1) % CYCLE.length];
      localStorage.setItem("pakad-theme", next);
      return next;
    });
  }, []);

  return (
    <ThemeContext.Provider value={{ theme, effectiveTheme, setTheme, cycleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}
