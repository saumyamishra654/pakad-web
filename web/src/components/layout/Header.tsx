"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { signOut } from "firebase/auth";
import { auth } from "@/lib/firebase";
import { useAuthContext } from "./AuthProvider";
import { useTheme } from "./ThemeProvider";

export function Header() {
  const { user } = useAuthContext();
  const router = useRouter();
  const { theme, cycleTheme } = useTheme();

  const themeIcon = theme === "dark" ? "\u263D" : theme === "light" ? "\u2600" : "\u25D0";
  const themeLabel = theme === "dark" ? "Dark" : theme === "light" ? "Light" : "Auto";
  const nextLabel = theme === "dark" ? "light" : theme === "light" ? "auto" : "dark";

  async function handleSignOut() {
    await signOut(auth);
    router.push("/");
  }

  if (!user) {
    return (
      <header className="flex items-center justify-between px-6 py-4 border-b border-border">
        <Link href="/" className="text-xl font-semibold text-text-primary">
          Pakad
        </Link>
        <nav className="flex items-center gap-6">
          <Link href="/explore" className="text-text-secondary hover:text-text-primary transition-colors text-sm">
            Explore
          </Link>
          <button onClick={cycleTheme} className="text-text-secondary hover:text-text-primary transition-colors text-sm" aria-label={`Switch to ${nextLabel} theme`} title={`Theme: ${themeLabel}`}>
            {themeIcon}
            <span className="sr-only">Theme: {themeLabel}</span>
          </button>
          <Link href="/" className="text-accent hover:opacity-90 text-sm font-medium transition-opacity">
            Sign in
          </Link>
        </nav>
      </header>
    );
  }

  const initials = (user.displayName || user.email || "U")
    .split(" ")
    .map((s) => s[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  return (
    <header className="flex items-center justify-between px-6 py-4 border-b border-border">
      <Link href="/library" className="text-xl font-semibold text-text-primary">
        Pakad
      </Link>
      <nav className="flex items-center gap-6">
        <Link href="/library" className="text-text-secondary hover:text-text-primary transition-colors text-sm">
          Library
        </Link>
        <Link href="/explore" className="text-text-secondary hover:text-text-primary transition-colors text-sm">
          Explore
        </Link>
        <button onClick={cycleTheme} className="text-text-secondary hover:text-text-primary transition-colors text-sm" aria-label={`Switch to ${nextLabel} theme`} title={`Theme: ${themeLabel}`}>
          {themeIcon}
          <span className="sr-only">Theme: {themeLabel}</span>
        </button>
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-bg-elevated flex items-center justify-center text-xs text-text-secondary">
            {initials}
          </div>
          <button onClick={handleSignOut} className="text-text-muted hover:text-text-primary text-sm transition-colors">
            Sign out
          </button>
        </div>
      </nav>
    </header>
  );
}
