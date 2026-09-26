import { describe, it, expect, vi, beforeEach } from "vitest"
import { createRequire } from "module"
import worker from "../worker.js"
import { resetTables } from "./helpers/db.js"

// worker.js is CommonJS and does `require("./shop/stockAlerts/sender")` -
// grab the exact same cached CJS module.exports object here (rather than the
// ESM-interop import) so spying on `.sendQueuedStockAlerts` actually
// intercepts worker.js's real call, same gotcha documented in
// adminShippingRoster.test.js/worker.test.js's own createRequire usage.
const cjsStockAlertSender = createRequire(import.meta.url)("../shop/stockAlerts/sender.js")

beforeEach(async () => {
  await resetTables("stock_alert_queue")
})

describe("dispatchStockAlertEmails", () => {
  it("is exported and does not throw when the queue is empty", async () => {
    await expect(worker.dispatchStockAlertEmails()).resolves.not.toThrow()
  })

  it("delegates to stockAlerts/sender and returns the sent count", async () => {
    const spy = vi.spyOn(cjsStockAlertSender, "sendQueuedStockAlerts")
      .mockResolvedValue({ sent: 2, failed: 0, skipped: false })

    const sent = await worker.dispatchStockAlertEmails()

    expect(spy).toHaveBeenCalled()
    expect(sent).toBe(2)
    spy.mockRestore()
  })

  it("swallows a thrown error and returns 0, without affecting the caller", async () => {
    const spy = vi.spyOn(cjsStockAlertSender, "sendQueuedStockAlerts")
      .mockRejectedValue(new Error("boom"))

    const sent = await worker.dispatchStockAlertEmails()

    expect(sent).toBe(0)
    spy.mockRestore()
  })
})
