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

// ── Orders ──
export const createOrder = (payload) =>
  api.post("/api/orders", payload).then((r) => r.data)

export const fetchOrder = (token) =>
  api.get(`/api/orders/${token}`).then((r) => r.data)

// ── Admin orders ──
export const adminListOrders = (params = {}) =>
  api.get("/api/admin/orders", { params }).then((r) => r.data)

export const adminGetOrder = (id) =>
  api.get(`/api/admin/orders/${id}`).then((r) => r.data)

export const adminTransitionOrder = (id, payload) =>
  api.post(`/api/admin/orders/${id}/transition`, payload).then((r) => r.data)

export const adminBulkCancelOrders = (ids) =>
  api.post("/api/admin/orders/bulk-cancel", { ids }).then((r) => r.data)

export const adminBulkCompleteOrders = (ids) =>
  api.post("/api/admin/orders/bulk-complete", { ids }).then((r) => r.data)

// ── Payments ──
export const fetchPaymentMethods = () =>
  api.get("/api/shop/payment-methods").then((r) => r.data)

export const fetchPaymentInstructions = (token) =>
  api.get(`/api/orders/${token}/payment`).then((r) => r.data)

export const uploadPaymentProof = (token, base64) =>
  api.post(`/api/orders/${token}/proof`, { base64 }).then((r) => r.data)

export const adminGetPaymentSettings = () =>
  api.get("/api/admin/payment-settings").then((r) => r.data)

export const adminSavePaymentSettings = (data) =>
  api.put("/api/admin/payment-settings", data).then((r) => r.data)

// ── Email templates ──
export const adminListEmailTemplates = () =>
  api.get("/api/admin/email-templates").then((r) => r.data)

export const adminSaveEmailTemplate = (type, data) =>
  api.put(`/api/admin/email-templates/${type}`, data).then((r) => r.data)

export const adminListFailedEmails = () =>
  api.get("/api/admin/email-queue/failed").then((r) => r.data)

// ── Stats ──
export const adminGetDropStats = (collectionId) =>
  api.get(`/api/admin/stats/drop/${collectionId}`).then((r) => r.data)

export const adminGetRestockStats = () =>
  api.get("/api/admin/stats/restock").then((r) => r.data)

export const adminGetBookkeepingStats = (params) =>
  api.get("/api/admin/stats/bookkeeping", { params }).then((r) => r.data)

export const adminDownloadBookkeepingCsv = (params) =>
  api.get("/api/admin/stats/bookkeeping/export.csv", { params, responseType: "blob" }).then((r) => r.data)

// ── Shipping ──
export const adminListShippingExportOrders = () =>
  api.get("/api/admin/shipping/export/orders").then((r) => r.data)

export const adminSetShippingPayer = (id, shippingPayer) =>
  api.patch(`/api/admin/shipping/export/orders/${id}/payer`, { shipping_payer: shippingPayer }).then((r) => r.data)

export const adminGenerateShippingExport = (orderIds, batch) =>
  api.post("/api/admin/shipping/export", { order_ids: orderIds, batch }).then((r) => r.data)

export const adminPreviewTrackingImport = (payload) =>
  api.post("/api/admin/shipping/tracking-import/preview", payload).then((r) => r.data)

export const adminConfirmTrackingImport = (rows) =>
  api.post("/api/admin/shipping/tracking-import/confirm", { rows }).then((r) => r.data)

export const adminGetPickupRoster = (collectionId) =>
  api.get(`/api/admin/shipping/roster/${collectionId}`).then((r) => r.data)
