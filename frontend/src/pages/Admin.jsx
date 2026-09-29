import { useEffect, useState } from "react"
import axios from "axios"
import { api } from "../api/api"
import AdminAlbums from "../components/AdminAlbums"
import AdminSettings from "../components/AdminSettings"
import AdminCollections from "../components/AdminCollections"
import AdminShopGroupOrder from "../components/AdminShopGroupOrder"
import AdminOrders from "../components/AdminOrders"
import AdminBoothOrders from "../components/AdminBoothOrders"
import AdminPaymentSettings from "../components/AdminPaymentSettings"
import AdminGiftSettings from "../components/AdminGiftSettings"
import AdminEmailTemplates from "../components/AdminEmailTemplates"
import AdminStats from "../components/AdminStats"
import AdminShipping from "../components/AdminShipping"
import { useTheme } from "../contexts/ThemeContext"

const TOKEN_KEY = "admin_token"
const REFRESH_KEY = "admin_refresh_token"

export default function Admin() {
  const { theme, toggleTheme } = useTheme()
  const [tab, setTab] = useState("albums")
  // Read once at mount, applying the saved token to axios immediately so the
  // very first admin API call (before any effect runs) still authenticates -
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
  const [checkingSession, setCheckingSession] = useState(() => !token && !!localStorage.getItem(REFRESH_KEY))

  const logout = () => {
    setToken("")
    delete axios.defaults.headers.common["Authorization"]
    localStorage.removeItem(TOKEN_KEY)
    localStorage.removeItem(REFRESH_KEY)
  }

  const applySession = (data) => {
    axios.defaults.headers.common["Authorization"] = "Bearer " + data.token
    localStorage.setItem(TOKEN_KEY, data.token)
    if (data.refresh_token) localStorage.setItem(REFRESH_KEY, data.refresh_token)
    setToken(data.token)
  }

  // Access token can be entirely missing on mount while the refresh token is still good - redeem it before showing login
  useEffect(() => {
    if (token) return
    const refreshToken = localStorage.getItem(REFRESH_KEY)
    if (!refreshToken) return
    let cancelled = false
    axios
      .post("/api/refresh", { refresh_token: refreshToken })
      .then((r) => {
        if (!cancelled) applySession(r.data)
      })
      .catch(() => {
        if (!cancelled) {
          localStorage.removeItem(REFRESH_KEY)
        }
      })
      .finally(() => {
        if (!cancelled) setCheckingSession(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  // On a 401/403 mid-session, try the refresh token (30d vs the access token's 8h) and retry; only log out if that also fails.
  useEffect(() => {
    if (!token) return
    const id = api.interceptors.response.use(
      (res) => res,
      async (err) => {
        if (err.response?.status === 401 || err.response?.status === 403) {
          const refreshToken = localStorage.getItem(REFRESH_KEY)
          if (refreshToken && !err.config?._retriedAfterRefresh) {
            try {
              const r = await axios.post("/api/refresh", { refresh_token: refreshToken })
              applySession(r.data)
              err.config._retriedAfterRefresh = true
              err.config.headers.Authorization = "Bearer " + r.data.token
              return api.request(err.config)
            } catch {
              logout()
              return Promise.reject(err)
            }
          }
          logout()
        }
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
      applySession(r.data)
    } catch (err) {
      const msg = err.response?.data?.message || "Sai tên đăng nhập hoặc mật khẩu"
      setError(msg)
    }
  }

  if (token) {
    return (
      <div className="min-h-screen bg-gray-100 dark:bg-cosplay-dark">
        <header className="bg-white dark:bg-cosplay-card border-b border-gray-200 dark:border-cosplay-border sticky top-0 z-40">
          <div className="px-3 sm:px-4 py-2.5 sm:py-3 flex justify-between items-center gap-2">
            <h1 className="font-bold text-sm sm:text-lg text-gray-900 dark:text-slate-100 truncate min-w-0">Admin - Cosplay Portfolio</h1>
            <div className="flex items-center gap-1 shrink-0">
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
                className="text-xs sm:text-sm px-2 py-1 text-gray-600 dark:text-slate-500 hover:text-pink-500 dark:hover:text-pink-400 whitespace-nowrap"
              >
                Đăng xuất
              </button>
            </div>
          </div>
          {/* A horizontally scrolling pill strip, not flex-wrap: on a phone,
              9 tabs wrapped onto 3-4 cramped lines and pushed all page
              content down below the fold before it could even render.
              Scrolling keeps the header a fixed, predictable height at every
              width, and each tab stays a comfortable tap target instead of
              shrinking to fit. -mx-3/px-3 (sm: -mx-4/px-4) lets the scroll
              area bleed to the screen edge while the row above it stays
              aligned to the same padding as the rest of the header. */}
          <nav className="overflow-x-auto -mx-3 px-3 sm:-mx-4 sm:px-4 pb-2 sm:pb-2.5">
            <div className="flex gap-1.5 w-max">
              {[
                ["albums", "Albums"],
                ["settings", "Cài đặt trang"],
                ["shop", "Shop"],
                ["orders", "Đơn hàng"],
                ["booth", "Tại quầy"],
                ["payments", "Thanh toán"],
                ["email", "Email"],
                ["stats", "Thống kê"],
                ["shipping", "Vận chuyển"],
              ].map(([id, label]) => (
                <button
                  key={id}
                  onClick={() => setTab(id)}
                  className={`text-sm px-3 py-1.5 rounded-full whitespace-nowrap transition-colors ${
                    tab === id
                      ? "bg-pink-500 text-white"
                      : "text-gray-600 dark:text-slate-400 hover:bg-gray-100 dark:hover:bg-cosplay-dark"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </nav>
        </header>
        {/* Every tab page below renders its own content with no padding of
            its own (see e.g. AdminOrders.jsx's bare `<div>` root) - on
            mobile that put every page's content flush against the screen
            edge with zero margin. One shared padded wrapper here fixes it
            everywhere at once, instead of touching every page component. */}
        <main className="p-3 sm:p-4 md:p-6">
          {tab === "albums" && <AdminAlbums />}
          {tab === "settings" && <AdminSettings />}
          {tab === "shop" && (
            <>
              <AdminShopGroupOrder />
              <AdminCollections />
            </>
          )}
          {tab === "orders" && <AdminOrders />}
          {tab === "booth" && <AdminBoothOrders />}
          {tab === "payments" && (
            <>
              <AdminPaymentSettings />
              <AdminGiftSettings />
            </>
          )}
          {tab === "email" && <AdminEmailTemplates />}
          {tab === "stats" && <AdminStats />}
          {tab === "shipping" && <AdminShipping />}
        </main>
      </div>
    )
  }

  if (checkingSession) {
    return <div className="min-h-screen bg-gray-100 dark:bg-cosplay-dark" />
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
