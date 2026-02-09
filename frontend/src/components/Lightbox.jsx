export default function Lightbox({ src, caption = "", onClose }) {
  if (!src) return null
  return (
    <div
      className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-2 sm:p-4 overflow-auto"
      onClick={onClose}
    >
      <div
        className="max-w-4xl w-full my-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <img src={src} alt={caption} className="w-full h-auto rounded-lg max-h-[85vh] sm:max-h-[90vh] object-contain shadow-pink-glow" />
        {caption && (
          <div className="mt-2 sm:mt-3 text-pink-400 dark:text-pink-300 text-xs sm:text-sm text-center">{caption}</div>
        )}
      </div>
    </div>
  )
}
