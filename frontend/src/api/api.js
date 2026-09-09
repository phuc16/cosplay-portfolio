import axios from "axios"

export const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || ""
})

// axios.create() snapshots axios.defaults at creation time, so later
// mutations of axios.defaults.headers.common (e.g. Admin.jsx setting/deleting
// the Authorization header on login/logout) never reach this instance.
// Without this interceptor every admin API call made through `api` (all of
// shop.js) goes out unauthenticated. Re-read the global default per request
// instead of relying on the stale snapshot.
api.interceptors.request.use((config) => {
  const globalAuth = axios.defaults.headers.common["Authorization"]
  if (config.headers.Authorization === undefined) {
    if (globalAuth) {
      config.headers.Authorization = globalAuth
    } else {
      delete config.headers.Authorization
    }
  }
  return config
})
