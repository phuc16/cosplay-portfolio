import { BrowserRouter, Routes, Route } from "react-router-dom"
import { ThemeProvider } from "./contexts/ThemeContext"
import { LanguageProvider } from "./contexts/LanguageContext"
import Portfolio from "./pages/Portfolio"
import Admin from "./pages/Admin"
import Shop from "./pages/Shop"
import Collection from "./pages/Collection"
import Cart from "./pages/Cart"
import Checkout from "./pages/Checkout"

export default function App() {
  return (
    <ThemeProvider>
      <LanguageProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<Portfolio />} />
            <Route path="/admin" element={<Admin />} />
            <Route path="/shop" element={<Shop />} />
            <Route path="/shop/:slug" element={<Collection />} />
            <Route path="/cart" element={<Cart />} />
            <Route path="/checkout" element={<Checkout />} />
          </Routes>
        </BrowserRouter>
      </LanguageProvider>
    </ThemeProvider>
  )
}
