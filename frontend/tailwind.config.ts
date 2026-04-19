import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: {
          DEFAULT: "#f4f1e8",
          elevated: "#ede9da",
          panel: "#ebe6d6",
          ribbon: "#0e1a22",
        },
        border: {
          DEFAULT: "#d4cfc0",
          strong: "#b8b0a0",
        },
        ink: {
          DEFAULT: "#1a1a1a",
          dim: "#666666",
          faint: "#999999",
          ribbon: "#e8e4d8",
        },
        risk: {
          clear: "#22c55e",
          monitor: "#ca8a04",
          advisory: "#ea580c",
          danger: "#dc2626",
        },
        accent: {
          DEFAULT: "#7fb2c9",
          strong: "#2d5a7a",
          danger: "#a63d2a",
        },
      },
      fontFamily: {
        sans: ["Inter Tight", "Inter", "system-ui", "-apple-system", "sans-serif"],
        mono: ["JetBrains Mono", "ui-monospace", "monospace"],
      },
      boxShadow: {
        panel: "0 1px 2px rgba(0,0,0,0.06), 0 4px 12px rgba(0,0,0,0.08)",
      },
      keyframes: {
        "fade-in": {
          from: { opacity: "0" },
          to: { opacity: "1" },
        },
        "slide-up": {
          from: { opacity: "0", transform: "translateY(6px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        "slide-down": {
          from: { opacity: "0", transform: "translateY(-8px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        "slide-right": {
          from: { opacity: "0", transform: "translateX(-6px)" },
          to: { opacity: "1", transform: "translateX(0)" },
        },
        "dot-pulse": {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.3" },
        },
        "number-flash": {
          "0%": { opacity: "1" },
          "30%": { opacity: "0.6" },
          "100%": { opacity: "1" },
        },
      },
      animation: {
        "fade-in": "fade-in 0.4s ease-out both",
        "slide-up": "slide-up 0.25s ease-out both",
        "slide-down": "slide-down 0.28s ease-out both",
        "slide-right": "slide-right 0.2s ease-out both",
        "dot-pulse": "dot-pulse 1.4s ease-in-out infinite",
        "number-flash": "number-flash 0.3s ease-out both",
      },
    },
  },
  plugins: [],
} satisfies Config;
