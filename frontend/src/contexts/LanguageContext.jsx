import { createContext, useContext, useEffect, useState } from "react"
import { translations } from "../i18n/translations"

const LanguageContext = createContext()

export function LanguageProvider({ children }) {
  const [lang, setLangState] = useState(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem("lang") || "en"
    }
    return "en"
  })

  useEffect(() => {
    localStorage.setItem("lang", lang)
  }, [lang])

  const t = (key, params = {}) => {
    let str = translations[lang]?.[key] ?? translations.en?.[key] ?? key
    Object.entries(params).forEach(([k, v]) => {
      str = str.replace(new RegExp(`\\{${k}\\}`, "g"), String(v))
    })
    return str
  }

  const setLang = (l) => setLangState(l === "vi" || l === "en" ? l : "en")

  return (
    <LanguageContext.Provider value={{ lang, setLang, t }}>
      {children}
    </LanguageContext.Provider>
  )
}

export function useLanguage() {
  const ctx = useContext(LanguageContext)
  if (!ctx) throw new Error("useLanguage must be used within LanguageProvider")
  return ctx
}
