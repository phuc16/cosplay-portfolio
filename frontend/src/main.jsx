import React from "react"
import ReactDOM from "react-dom/client"
import axios from "axios"
import App from "./App"
import "./index.css"

// axios.create() (api/api.js) snapshots axios.defaults at creation time, and
// nothing else runs this restore before Admin.jsx itself mounts - so a page
// like the gacha kiosk, opened by direct URL without ever visiting /admin in
// this tab, would read a real token from localStorage (hasAdminSession()
// says "logged in") while every actual request still went out unauthenticated.
// Mirrors Admin.jsx's own restore, just at the one place that runs before any
// route's first API call, regardless of which page loads first.
const savedAdminToken = localStorage.getItem("admin_token")
if (savedAdminToken) axios.defaults.headers.common["Authorization"] = "Bearer " + savedAdminToken

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
