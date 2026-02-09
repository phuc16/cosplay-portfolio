export default function SmallStat({ number, label }) {
  return (
    <div className="bg-gray-100 dark:bg-cosplay-darker/50 border border-gray-200 dark:border-cosplay-border p-2 sm:p-3 rounded-md text-center">
      <div className="font-bold text-lg sm:text-xl text-pink-500 dark:text-pink-400">{number}</div>
      <div className="text-[10px] sm:text-xs text-gray-500 dark:text-slate-500 truncate">{label}</div>
    </div>
  )
}
