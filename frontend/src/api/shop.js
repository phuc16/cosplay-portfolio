import { api } from "./api"

// ── Public storefront ──
export const fetchCollections = () =>
  api.get("/api/shop/collections").then((r) => r.data)

export const fetchCollection = (slug) =>
  api.get(`/api/shop/collections/${slug}`).then((r) => r.data)

// ── Admin catalog (JWT is set globally on axios by Admin.jsx) ──
export const adminListCollections = () =>
  api.get("/api/admin/collections").then((r) => r.data)

export const adminGetCollection = (id) =>
  api.get(`/api/admin/collections/${id}`).then((r) => r.data)

export const adminCreateCollection = (data) =>
  api.post("/api/admin/collections", data).then((r) => r.data)

export const adminUpdateCollection = (id, data) =>
  api.put(`/api/admin/collections/${id}`, data).then((r) => r.data)

export const adminDeleteCollection = (id) =>
  api.delete(`/api/admin/collections/${id}`).then((r) => r.data)

export const adminCreateProduct = (collectionId, data) =>
  api.post(`/api/admin/collections/${collectionId}/products`, data).then((r) => r.data)

export const adminUpdateProduct = (id, data) =>
  api.put(`/api/admin/products/${id}`, data).then((r) => r.data)

export const adminDeleteProduct = (id) =>
  api.delete(`/api/admin/products/${id}`).then((r) => r.data)

export const adminSaveVariants = (productId, variants) =>
  api.put(`/api/admin/products/${productId}/variants`, { variants }).then((r) => r.data)

export const adminUploadImage = (base64, folder) =>
  api.post("/api/admin/shop/image", { base64, folder }).then((r) => r.data)
