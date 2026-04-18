import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: {
          DEFAULT: "#0a0e14",
          elevated: "#111722",
          panel: "#151c28",
        },
        border: {
          DEFAULT: "#1f2937",
          strong: "#334155",
        },
        ink: {
          DEFAULT: "#e5e7eb",
          dim: "#9ca3af",
          faint: "#6b7280",
        },
        risk: {
          clear: "#22c55e",
          monitor: "#eab308",
          advisory: "#f97316",
          danger: "#ef4444",
        },
        accent: {
          DEFAULT: "#38bdf8",
          strong: "#0ea5e9",
        },
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "-apple-system", "sans-serif"],
        mono: ["JetBrains Mono", "ui-monospace", "monospace"],
      },
      boxShadow: {
        panel: "0 1px 2px rgba(0,0,0,0.4), 0 8px 24px rgba(0,0,0,0.3)",
      },
    },
  },
  plugins: [],
} satisfies Config;
