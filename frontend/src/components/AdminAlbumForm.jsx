import { useState, useEffect } from "react"

export default function AdminAlbumForm({ album, onSave, onCancel, title }) {
  const [titleVal, setTitleVal] = useState(album?.title || "")
  const [desc, setDesc] = useState(album?.description || "")

  /* eslint-disable react-hooks/set-state-in-effect -- sync form fields when the edited album prop changes */
  useEffect(() => {
    if (album) {
      setTitleVal(album.title || "")
      setDesc(album.description || "")
    }
  }, [album])
  /* eslint-enable react-hooks/set-state-in-effect */

  const submit = (e) => {
    e.preventDefault()
    onSave(titleVal.trim(), desc.trim())
  }

  return (
    <form
      onSubmit={submit}
      className="mb-6 p-4 bg-white dark:bg-cosplay-card rounded-lg border border-gray-200 dark:border-cosplay-border space-y-4"
    >
      <h3 className="font-bold text-gray-900 dark:text-slate-100">{title}</h3>
      <div>
        <label className="block text-sm font-medium text-gray-600 dark:text-slate-400 mb-1">Tên album</label>
        <input
          type="text"
          value={titleVal}
          onChange={(e) => setTitleVal(e.target.value)}
          className="w-full border border-gray-300 dark:border-cosplay-border bg-gray-50 dark:bg-cosplay-darker rounded-md p-2 text-gray-900 dark:text-slate-200"
          placeholder="VD: Genshin - Keqing"
          required
        />
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-600 dark:text-slate-400 mb-1">Mô tả (tùy chọn)</label>
        <textarea
          value={desc}
          onChange={(e) => setDesc(e.target.value)}
          className="w-full border border-gray-300 dark:border-cosplay-border bg-gray-50 dark:bg-cosplay-darker rounded-md p-2 text-gray-900 dark:text-slate-200"
          rows={2}
          placeholder="Mô tả ngắn..."
        />
      </div>
      <div className="flex gap-2">
        <button
          type="submit"
          className="px-4 py-2 rounded-md bg-pink-500 text-white font-medium hover:bg-pink-400"
        >
          Lưu
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="px-4 py-2 rounded-md border border-gray-300 dark:border-cosplay-border text-gray-600 dark:text-slate-400 hover:bg-gray-100 dark:hover:bg-cosplay-card"
        >
          Hủy
        </button>
      </div>
    </form>
  )
}
