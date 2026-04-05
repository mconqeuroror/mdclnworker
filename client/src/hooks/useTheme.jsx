import { createContext, useContext, useState, useEffect, useCallback } from "react";

const STORAGE_KEY = "mc-theme";
const ThemeContext = createContext({ theme: "dark", toggleTheme: () => {} });

function getInitialTheme() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "light" || stored === "dark") return stored;
  } catch {}
  return "dark";
}

function applyTheme(t) {
  const html = document.documentElement;
  // Remove stale state
  html.classList.remove("light", "dark");
  html.removeAttribute("data-theme");
  // Apply new theme
  html.setAttribute("data-theme", t);
  html.classList.add(t === "light" ? "light" : "dark");
  // Force background directly — inline style beats all CSS cascade issues
  const pageBg = t === "light" ? "#eef1f7" : "#050505";
  html.style.background = pageBg;
  if (document.body) document.body.style.background = pageBg;
  try { localStorage.setItem(STORAGE_KEY, t); } catch {}
}

applyTheme(getInitialTheme());

export function ThemeProvider({ children }) {
  const [theme, setTheme] = useState(getInitialTheme);

  useEffect(() => { applyTheme(theme); }, [theme]);

  const toggleTheme = useCallback(() => {
    setTheme((prev) => (prev === "dark" ? "light" : "dark"));
  }, []);

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
