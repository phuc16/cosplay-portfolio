import ScrollReveal from "./ScrollReveal"
import { useLanguage } from "../contexts/LanguageContext"

export default function UpcomingEvents({ events = [] }) {
  const { t } = useLanguage()
  const count = events?.length || 0

  return (
    <section id="events" className="max-w-4xl mx-auto px-4 sm:px-6 md:px-8 mt-8 sm:mt-12 pb-8 sm:pb-12">
      <ScrollReveal delay={100}>
        <div className="bg-white dark:bg-cosplay-card rounded-lg sm:rounded-xl border border-gray-200 dark:border-cosplay-border p-4 sm:p-6 md:p-10 shadow-pink-soft">
          <h3 className="text-lg sm:text-xl font-bold text-gray-900 dark:text-slate-100">{t("upcomingEventsTitle")}</h3>
          {count > 0 ? (
            <>
              <p className="text-sm text-gray-500 dark:text-slate-500 mt-1">{t(count === 1 ? "eventCount" : "eventCountPlural", { n: count })}</p>
              <ul className="mt-4 space-y-3">
                {events.map((ev, i) => (
                  <li key={i} className="flex items-center gap-3 text-sm sm:text-base">
                    <span className="w-2 h-2 rounded-full bg-pink-500 shrink-0" />
                    {ev.url ? (
                      <a
                        href={ev.url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-pink-500 dark:text-pink-400 hover:text-pink-600 dark:hover:text-pink-300 hover:underline"
                      >
                        {ev.title}
                        {ev.date && <span className="text-gray-500 dark:text-slate-500 ml-2">({ev.date})</span>}
                      </a>
                    ) : (
                      <span className="text-gray-700 dark:text-slate-300">
                        {ev.title}
                        {ev.date && <span className="text-gray-500 dark:text-slate-500 ml-2">({ev.date})</span>}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="text-sm text-gray-500 dark:text-slate-500 mt-2">{t("noUpcomingEvents")}</p>
          )}
        </div>
      </ScrollReveal>
    </section>
  )
}
