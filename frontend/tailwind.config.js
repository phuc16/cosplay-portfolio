export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        cosplay: {
          dark: "#0d0d14",
          darker: "#08080c",
          card: "#15151f",
          border: "#2a2a3a",
          pink: "#ec4899",
          "pink-glow": "#f472b6",
        },
      },
      boxShadow: {
        "pink-glow": "0 0 20px rgba(236, 72, 153, 0.3)",
        "pink-soft": "0 4px 14px rgba(236, 72, 153, 0.15)",
      },
      animation: {
        "reveal-up": "revealUp 0.7s ease-out forwards",
      },
      keyframes: {
        revealUp: {
          "0%": { opacity: "0", transform: "translateY(2rem)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
      },
    },
  },
  plugins: [],
}
