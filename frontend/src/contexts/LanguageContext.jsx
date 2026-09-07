/* eslint-disable react-refresh/only-export-components -- context module exports both Provider and hook by design */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react"
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

  const t = useCallback((key, params = {}) => {
    let str = translations[lang]?.[key] ?? translations.en?.[key] ?? key
    Object.entries(params).forEach(([k, v]) => {
      str = str.replace(new RegExp(`\\{${k}\\}`, "g"), String(v))
    })
    return str
  }, [lang])

  const setLang = (l) => setLangState(l === "vi" || l === "en" ? l : "en")

  const value = useMemo(() => ({ lang, setLang, t }), [lang, setLang, t])

  return (
    <LanguageContext.Provider value={value}>
      {children}
    </LanguageContext.Provider>
  )
}

export function useLanguage() {
  const ctx = useContext(LanguageContext)
  if (!ctx) throw new Error("useLanguage must be used within LanguageProvider")
  return ctx
}
