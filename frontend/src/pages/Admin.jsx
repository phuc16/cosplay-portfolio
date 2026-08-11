import { useEffect, useState } from "react"
import axios from "axios"
import { api } from "../api/api"
import AdminAlbums from "../components/AdminAlbums"
import AdminSettings from "../components/AdminSettings"
import AdminCollections from "../components/AdminCollections"
import AdminOrders from "../components/AdminOrders"
import AdminPaymentSettings from "../components/AdminPaymentSettings"
import AdminEmailTemplates from "../components/AdminEmailTemplates"
import AdminStats from "../components/AdminStats"
import AdminShipping from "../components/AdminShipping"
import { useTheme } from "../contexts/ThemeContext"

const TOKEN_KEY = "admin_token"

export default function Admin() {
  const { theme, toggleTheme } = useTheme()
  const [tab, setTab] = useState("albums")
  // Read once at mount, applying the saved token to axios immediately so the
  // very first admin API call (before any effect runs) still authenticates —
  // without this, a page refresh loses the session even though the JWT
  // (8h expiry) is still valid.
  const [token, setToken] = useState(() => {
    const saved = localStorage.getItem(TOKEN_KEY)
    if (saved) axios.defaults.headers.common["Authorization"] = "Bearer " + saved
    return saved || ""
  })
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState("")

  const logout = () => {
    setToken("")
    delete axios.defaults.headers.common["Authorization"]
    localStorage.removeItem(TOKEN_KEY)
  }

  // A restored or still-active token can still expire mid-session (8h JWT) —
  // when that happens the server answers 401/403 and every admin tab would
  // otherwise sit there silently failing. Drop back to the login screen
  // instead of leaving a session that looks alive but isn't.
  useEffect(() => {
    if (!token) return
    const id = api.interceptors.response.use(
      (res) => res,
      (err) => {
        if (err.response?.status === 401 || err.response?.status === 403) logout()
        return Promise.reject(err)
      }
    )
    return () => api.interceptors.response.eject(id)
  }, [token])

  const login = async (e) => {
    e?.preventDefault()
    setError("")
    try {
      const r = await axios.post("/api/login", { username, password })
      axios.defaults.headers.common["Authorization"] = "Bearer " + r.data.token
      localStorage.setItem(TOKEN_KEY, r.data.token)
      setToken(r.data.token)
    } catch (err) {
      const msg = err.response?.data?.message || "Sai tên đăng nhập hoặc mật khẩu"
      setError(msg)
    }
  }

  if (token) {
    return (
      <div className="min-h-screen bg-gray-100 dark:bg-cosplay-dark">
        <header className="bg-white dark:bg-cosplay-card border-b border-gray-200 dark:border-cosplay-border px-3 sm:px-4 py-3 flex flex-wrap justify-between items-center gap-2">
          <h1 className="font-bold text-base sm:text-lg text-gray-900 dark:text-slate-100 truncate min-w-0">Admin — Cosplay Portfolio</h1>
          <div className="flex flex-wrap gap-2 sm:gap-4 items-center shrink-0">
            <button
              onClick={() => setTab("albums")}
              className={`text-sm ${tab === "albums" ? "text-pink-500 dark:text-pink-400" : "text-gray-600 dark:text-slate-500 hover:text-gray-900 dark:hover:text-slate-300"}`}
            >
              Albums
            </button>
            <button
              onClick={() => setTab("settings")}
              className={`text-sm ${tab === "settings" ? "text-pink-500 dark:text-pink-400" : "text-gray-600 dark:text-slate-500 hover:text-gray-900 dark:hover:text-slate-300"}`}
            >
              Cài đặt trang
            </button>
            <button
              onClick={() => setTab("shop")}
              className={`text-sm ${tab === "shop" ? "text-pink-500 dark:text-pink-400" : "text-gray-600 dark:text-slate-500 hover:text-gray-900 dark:hover:text-slate-300"}`}
            >
              Shop
            </button>
            <button
              onClick={() => setTab("orders")}
              className={`text-sm ${tab === "orders" ? "text-pink-500 dark:text-pink-400" : "text-gray-600 dark:text-slate-500 hover:text-gray-900 dark:hover:text-slate-300"}`}
            >
              Đơn hàng
            </button>
            <button
              onClick={() => setTab("payments")}
              className={`text-sm ${tab === "payments" ? "text-pink-500 dark:text-pink-400" : "text-gray-600 dark:text-slate-500 hover:text-gray-900 dark:hover:text-slate-300"}`}
            >
              Thanh toán
            </button>
            <button
              onClick={() => setTab("email")}
              className={`text-sm ${tab === "email" ? "text-pink-500 dark:text-pink-400" : "text-gray-600 dark:text-slate-500 hover:text-gray-900 dark:hover:text-slate-300"}`}
            >
              Email
            </button>
            <button
              onClick={() => setTab("stats")}
              className={`text-sm ${tab === "stats" ? "text-pink-500 dark:text-pink-400" : "text-gray-600 dark:text-slate-500 hover:text-gray-900 dark:hover:text-slate-300"}`}
            >
              Thống kê
            </button>
            <button
              onClick={() => setTab("shipping")}
              className={`text-sm ${tab === "shipping" ? "text-pink-500 dark:text-pink-400" : "text-gray-600 dark:text-slate-500 hover:text-gray-900 dark:hover:text-slate-300"}`}
            >
              Vận chuyển
            </button>
            <button
              onClick={toggleTheme}
              className="p-2 rounded-md text-gray-600 dark:text-slate-500 hover:bg-gray-100 dark:hover:bg-cosplay-card"
              title={theme === "dark" ? "Chế độ sáng" : "Chế độ tối"}
            >
              {theme === "dark" ? (
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
                </svg>
              ) : (
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
                </svg>
              )}
            </button>
            <button
              onClick={logout}
              className="text-sm text-gray-600 dark:text-slate-500 hover:text-pink-500 dark:hover:text-pink-400"
            >
              Đăng xuất
            </button>
          </div>
        </header>
        {tab === "albums" && <AdminAlbums />}
        {tab === "settings" && <AdminSettings />}
        {tab === "shop" && <AdminCollections />}
        {tab === "orders" && <AdminOrders />}
        {tab === "payments" && <AdminPaymentSettings />}
        {tab === "email" && <AdminEmailTemplates />}
        {tab === "stats" && <AdminStats />}
        {tab === "shipping" && <AdminShipping />}
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-100 dark:bg-cosplay-dark flex items-center justify-center p-3 sm:p-4">
      <div className="bg-white dark:bg-cosplay-card border border-gray-200 dark:border-cosplay-border rounded-lg sm:rounded-xl shadow-pink-soft p-5 sm:p-8 w-full max-w-sm">
        <h2 className="text-lg sm:text-xl font-bold text-gray-900 dark:text-slate-100 mb-1">Đăng nhập Admin</h2>
        <p className="text-sm text-gray-500 dark:text-slate-500 mb-5 sm:mb-6">Cosplay Portfolio · trang quản trị</p>
        <form onSubmit={login}>
          <div>
            <label className="block text-sm font-medium text-gray-600 dark:text-slate-400 mb-1">Tên đăng nhập</label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full border border-gray-300 dark:border-cosplay-border bg-gray-50 dark:bg-cosplay-darker rounded-md p-2 text-gray-900 dark:text-slate-200 placeholder-gray-500 dark:placeholder-slate-500"
              placeholder="admin"
              required
            />
          </div>
          <div className="mt-4">
            <label className="block text-sm font-medium text-gray-600 dark:text-slate-400 mb-1">Mật khẩu</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full border border-gray-300 dark:border-cosplay-border bg-gray-50 dark:bg-cosplay-darker rounded-md p-2 text-gray-900 dark:text-slate-200 placeholder-gray-500 dark:placeholder-slate-500"
              placeholder="••••••••"
              required
            />
          </div>
          {error && <p className="mt-2 text-sm text-red-400">{error}</p>}
          <button
            type="submit"
            className="mt-6 w-full py-2 rounded-md bg-pink-500 text-white font-medium hover:bg-pink-400 transition-colors"
          >
            Đăng nhập
          </button>
        </form>
      </div>
    </div>
  )
}
