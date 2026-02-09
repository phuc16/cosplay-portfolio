import { useLanguage } from "../contexts/LanguageContext"

export default function Supports({ supports = {} }) {
  const { t } = useLanguage()
  const items =
    typeof supports === "object" && !Array.isArray(supports)
      ? [
          supports.gumroad && { label: "Gumroad", url: supports.gumroad },
          supports.gank && { label: "Gank", url: supports.gank },
          supports.paypal && { label: "PayPal", url: supports.paypal },
        ].filter(Boolean)
      : Array.isArray(supports)
        ? supports.filter((s) => s?.url)
        : []

  if (items.length === 0) return null

  return (
    <section id="supports" className="scroll-mt-4 max-w-4xl mx-auto px-4 sm:px-6 md:px-8 mt-8 sm:mt-12 pb-8 sm:pb-12">
      <div className="bg-white dark:bg-cosplay-card rounded-lg sm:rounded-xl border border-gray-200 dark:border-cosplay-border p-4 sm:p-6 md:p-10 shadow-pink-soft">
        <h2 className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-slate-100">{t("supportsTitle")}</h2>
        <p className="text-sm sm:text-base text-gray-600 dark:text-slate-400 mt-1 sm:mt-2">
          {t("supportsDesc")}
        </p>
        <div className="mt-4 flex gap-3 flex-wrap">
        {items.map((s) => (
          <a
            key={s.label}
            href={s.url}
            target="_blank"
            rel="noreferrer"
            className="px-4 py-2.5 rounded-md border border-gray-300 dark:border-cosplay-border text-gray-700 dark:text-slate-300 hover:bg-gray-100 dark:hover:bg-cosplay-card hover:border-pink-500/50 hover:text-pink-500 dark:hover:text-pink-400 transition-colors font-medium"
          >
            {s.label}
          </a>
        ))}
        </div>
      </div>
    </section>
  )
}
