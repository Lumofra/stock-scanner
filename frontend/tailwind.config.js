/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        surface: "#0d1117",
        panel: "#161b22",
        border: "#21262d",
        muted: "#8b949e",
        green: { trade: "#26a69a" },
        red: { trade: "#ef5350" },
      },
      fontFamily: {
        mono: ["JetBrains Mono", "Fira Code", "monospace"],
      },
    },
  },
  plugins: [],
};
