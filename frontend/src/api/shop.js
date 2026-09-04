import { api } from "./api"

// ── Public storefront ──
export const fetchCollections = () =>
  api.get("/api/shop/collections").then((r) => r.data)

export const fetchCollection = (slug) =>
  api.get(`/api/shop/collections/${slug}`).then((r) => r.data)

// Province/ward reference data — proxied + cached server-side (30 days,
// see backend/shop/vnAddress.js), not a live per-keystroke lookup.
export const fetchProvinces = () =>
  api.get("/api/shop/provinces").then((r) => r.data)

export const fetchWards = (provinceCode) =>
  api.get(`/api/shop/wards/${provinceCode}`).then((r) => r.data)

// On-demand street search — only called from an explicit search-button
// click (see AddressFields.jsx), never per keystroke.
export const searchAddress = (input, ward, province) =>
  api.get("/api/shop/address-search", { params: { input, ward, province } }).then((r) => r.data)

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

export const adminCopyCollection = (id) =>
  api.post(`/api/admin/collections/${id}/copy`).then((r) => r.data)

export const adminCreateProduct = (collectionId, data) =>
  api.post(`/api/admin/collections/${collectionId}/products`, data).then((r) => r.data)

export const adminUpdateProduct = (id, data) =>
  api.put(`/api/admin/products/${id}`, data).then((r) => r.data)

export const adminDeleteProduct = (id) =>
  api.delete(`/api/admin/products/${id}`).then((r) => r.data)

export const adminReorderProducts = (collectionId, productIds) =>
  api.put(`/api/admin/collections/${collectionId}/products/reorder`, { product_ids: productIds }).then((r) => r.data)

export const adminSaveVariants = (productId, variants) =>
  api.put(`/api/admin/products/${productId}/variants`, { variants }).then((r) => r.data)

export const adminUploadImage = (base64, folder) =>
  api.post("/api/admin/shop/image", { base64, folder }).then((r) => r.data)

// ── Orders ──
export const createOrder = (payload) =>
  api.post("/api/orders", payload).then((r) => r.data)

export const fetchOrder = (token, headers = {}) =>
  api.get(`/api/orders/${token}`, { headers }).then((r) => r.data)

export const verifyOrderPin = (token, pin) =>
  api.post(`/api/orders/${token}/verify-pin`, { pin }).then((r) => r.data)

// ── Admin orders ──
export const adminListOrders = (params = {}) =>
  api.get("/api/admin/orders", { params }).then((r) => r.data)

export const adminGetOrder = (id) =>
  api.get(`/api/admin/orders/${id}`).then((r) => r.data)

export const adminFindOrderByToken = (token) =>
  api.get(`/api/admin/orders/by-token/${token}`).then((r) => r.data)

export const adminGetOrderPayment = (id) =>
  api.get(`/api/admin/orders/${id}/payment`).then((r) => r.data)

export const adminTransitionOrder = (id, payload) =>
  api.post(`/api/admin/orders/${id}/transition`, payload).then((r) => r.data)

export const adminBulkCancelOrders = (ids) =>
  api.post("/api/admin/orders/bulk-cancel", { ids }).then((r) => r.data)

export const adminBulkCompleteOrders = (ids) =>
  api.post("/api/admin/orders/bulk-complete", { ids }).then((r) => r.data)

// ── Payments ──
export const fetchPaymentMethods = () =>
  api.get("/api/shop/payment-methods").then((r) => r.data)

export const fetchPaymentInstructions = (token, headers = {}) =>
  api.get(`/api/orders/${token}/payment`, { headers }).then((r) => r.data)

export const uploadPaymentProof = (token, base64, headers = {}) =>
  api.post(`/api/orders/${token}/proof`, { base64 }, { headers }).then((r) => r.data)

export const fetchOrderQrBlob = (token, headers = {}) =>
  api.get(`/api/orders/${token}/qr.svg`, { headers, responseType: "blob" }).then((r) => r.data)

export const fetchPaymentQrBlob = (token, headers = {}) =>
  api.get(`/api/orders/${token}/payment/qr.svg`, { headers, responseType: "blob" }).then((r) => r.data)

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

export const adminDownloadDropStatsCsv = (collectionId) =>
  api.get(`/api/admin/stats/drop/${collectionId}/export.csv`, { responseType: "blob" }).then((r) => r.data)

export const adminGetRestockStats = (collectionId) =>
  api.get("/api/admin/stats/restock", { params: collectionId ? { collection_id: collectionId } : {} }).then((r) => r.data)

export const adminDownloadRestockStatsCsv = (collectionId) =>
  api.get("/api/admin/stats/restock/export.csv", {
    params: collectionId ? { collection_id: collectionId } : {},
    responseType: "blob",
  }).then((r) => r.data)

export const adminGetBookkeepingStats = (params) =>
  api.get("/api/admin/stats/bookkeeping", { params }).then((r) => r.data)

export const adminDownloadBookkeepingCsv = (params) =>
  api.get("/api/admin/stats/bookkeeping/export.csv", { params, responseType: "blob" }).then((r) => r.data)

// ── Shipping ──
export const adminListShippingExportOrders = (collectionId) =>
  api.get("/api/admin/shipping/export/orders", {
    params: collectionId ? { collection_id: collectionId } : {},
  }).then((r) => r.data)

export const adminSetShippingPayer = (id, shippingPayer) =>
  api.patch(`/api/admin/shipping/export/orders/${id}/payer`, { shipping_payer: shippingPayer }).then((r) => r.data)

export const adminSetOrderPrepared = (id, prepared) =>
  api.patch(`/api/admin/shipping/export/orders/${id}/prepared`, { prepared }).then((r) => r.data)

export const adminGenerateShippingExport = (orderIds, batch) =>
  api.post("/api/admin/shipping/export", { order_ids: orderIds, batch }).then((r) => r.data)

export const adminPreviewTrackingImport = (payload) =>
  api.post("/api/admin/shipping/tracking-import/preview", payload).then((r) => r.data)

export const adminConfirmTrackingImport = (rows) =>
  api.post("/api/admin/shipping/tracking-import/confirm", { rows }).then((r) => r.data)

export const adminGetPickupRoster = (collectionId) =>
  api.get(`/api/admin/shipping/roster/${collectionId}`).then((r) => r.data)
