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
        "pink-hover": "0 20px 25px -5px rgba(236, 72, 153, 0.20), 0 8px 10px -6px rgba(236, 72, 153, 0.20)",
      },
      animation: {
        "reveal-up": "revealUp 0.7s ease-out forwards",
        "lightbox-in": "lightboxIn 0.35s ease-out forwards",
        "lightbox-slide-next": "lightboxSlideNext 0.35s ease-out forwards",
        "lightbox-slide-prev": "lightboxSlidePrev 0.35s ease-out forwards",
      },
      keyframes: {
        revealUp: {
          "0%": { opacity: "0", transform: "translateY(2rem)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        lightboxIn: {
          "0%": { opacity: "0", transform: "scale(0.98)" },
          "100%": { opacity: "1", transform: "scale(1)" },
        },
        lightboxSlideNext: {
          "0%": { opacity: "0", transform: "translateX(40px)" },
          "100%": { opacity: "1", transform: "translateX(0)" },
        },
        lightboxSlidePrev: {
          "0%": { opacity: "0", transform: "translateX(-40px)" },
          "100%": { opacity: "1", transform: "translateX(0)" },
        },
      },
    },
  },
  plugins: [],
}
