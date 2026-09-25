import { describe, it, expect, afterEach, vi } from "vitest"
import { gachaAudio } from "./gachaAudio"

// A minimal stand-in for the Web Audio nodes gachaAudio actually calls.
// Matches the pattern already used in GachaMachine.test.jsx's "audio
// failures" describe block - real AudioContext doesn't exist in jsdom.
function installFakeAudioContext() {
  const sources = []
  window.AudioContext = function FakeAudioContext() {
    this.state = "running"
    this.currentTime = 0
    this.destination = {}
    this.createGain = () => ({ gain: { value: 0 }, connect: () => {} })
    this.createOscillator = () => ({
      type: "", frequency: { value: 0 }, connect: () => {}, start: () => {}, stop: () => {},
    })
    this.createBufferSource = () => {
      const src = {
        buffer: null, loop: false, connect: () => {}, start: vi.fn(), stop: vi.fn(), disconnect: vi.fn(),
      }
      sources.push(src)
      return src
    }
  }
  return sources
}

afterEach(() => {
  delete window.AudioContext
  gachaAudio.ctx = null
  gachaAudio.buffers = {}
  gachaAudio.bgmNode = null
  gachaAudio.bgmWanted = false
  gachaAudio.enabled = true
})

describe("gachaAudio BGM", () => {
  it("starts a looping buffer source connected to the bgm bus once the buffer is already cached", async () => {
    const sources = installFakeAudioContext()
    gachaAudio.buffers["bgm.mp3"] = { fake: "buffer" }

    gachaAudio.startBgm()

    expect(sources).toHaveLength(1)
    expect(sources[0].loop).toBe(true)
    expect(sources[0].buffer).toEqual({ fake: "buffer" })
    expect(sources[0].start).toHaveBeenCalledTimes(1)
    expect(gachaAudio.bgmWanted).toBe(true)
  })

  it("never starts a second source while one is already playing", () => {
    const sources = installFakeAudioContext()
    gachaAudio.buffers["bgm.mp3"] = { fake: "buffer" }

    gachaAudio.startBgm()
    gachaAudio.startBgm()

    expect(sources).toHaveLength(1)
  })

  it("stops the playing source and clears it on stopBgm", () => {
    installFakeAudioContext()
    gachaAudio.buffers["bgm.mp3"] = { fake: "buffer" }
    gachaAudio.startBgm()
    const node = gachaAudio.bgmNode

    gachaAudio.stopBgm()

    expect(node.stop).toHaveBeenCalledTimes(1)
    expect(gachaAudio.bgmNode).toBeNull()
    expect(gachaAudio.bgmWanted).toBe(false)
  })

  it("never starts when sound is disabled", () => {
    const sources = installFakeAudioContext()
    gachaAudio.buffers["bgm.mp3"] = { fake: "buffer" }
    gachaAudio.enabled = false

    gachaAudio.startBgm()

    expect(sources).toHaveLength(0)
    // Still records the intent, so re-enabling resumes it (see next test).
    expect(gachaAudio.bgmWanted).toBe(true)
  })

  it("toggling sound off stops bgm but keeps it wanted, and toggling back on resumes it", () => {
    const sources = installFakeAudioContext()
    gachaAudio.buffers["bgm.mp3"] = { fake: "buffer" }
    gachaAudio.startBgm()
    expect(sources).toHaveLength(1)

    gachaAudio.setEnabled(false)
    expect(gachaAudio.bgmNode).toBeNull()
    expect(gachaAudio.bgmWanted).toBe(true)

    gachaAudio.setEnabled(true)
    expect(sources).toHaveLength(2)
    expect(gachaAudio.bgmNode).not.toBeNull()
  })

  it("toggling sound on a page that never called startBgm never starts one", () => {
    const sources = installFakeAudioContext()
    gachaAudio.buffers["bgm.mp3"] = { fake: "buffer" }
    gachaAudio.enabled = false

    gachaAudio.setEnabled(true)

    expect(sources).toHaveLength(0)
  })

  it("retries a few times when the buffer isn't decoded yet, then starts once it is", async () => {
    vi.useFakeTimers()
    const sources = installFakeAudioContext()
    // Not cached yet - loadBuffer will kick off a fetch it can't complete in
    // this test (no real network), so the buffer stays null until we seed it.
    gachaAudio.startBgm()
    expect(sources).toHaveLength(0)

    gachaAudio.buffers["bgm.mp3"] = { fake: "buffer" }
    await vi.advanceTimersByTimeAsync(300)

    expect(sources).toHaveLength(1)
    vi.useRealTimers()
  })
})
