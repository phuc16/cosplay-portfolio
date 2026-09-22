import { useEffect, useState } from "react"
import { TIER_ORDER } from "./tiers"

const CLIP_BASE = "/sounds/gacha/"

// Tier index → reveal clip, ported from the mockup's chime(): the files keep
// their original names from the mockup's asset set, so the mapping is by
// position in TIER_ORDER rather than by filename.
const REVEAL_CLIPS = [
  "reveal.mp3",
  "reveal-mythical.mp3",
  "reveal-legendary.mp3",
  "reveal-ancient.mp3",
  "reveal-orange.mp3",
]

const CLIPS = ["tick.mp3", "opening.mp3", ...REVEAL_CLIPS]

const STORAGE_KEY = "gacha_sound_on"

// Every Web Audio call is behind this: the test environment is jsdom, which
// has neither AudioContext nor a working fetch for /sounds, and the component
// must render there without throwing.
function audioContextCtor() {
  if (typeof window === "undefined") return null
  return window.AudioContext || window.webkitAudioContext || null
}

// Audio is enhancement, never core functionality. Every public method routes
// through this: a throw from the Web Audio layer - most realistically the
// AudioContext constructor on a locked-down browser - would otherwise abort the
// caller mid-spin, after the draw has already been committed server-side,
// leaving a paid turn wedged behind a frozen reel.
function neverThrows(label, fn) {
  try {
    return fn()
  } catch (e) {
    console.warn("[gacha audio]", label, e?.message)
    return null
  }
}

function readStoredPreference() {
  try {
    return window.localStorage.getItem(STORAGE_KEY) !== "0"
  } catch {
    return true
  }
}

class GachaAudio {
  constructor() {
    this.enabled = typeof window === "undefined" ? true : readStoredPreference()
    this.listeners = new Set()
    this.buffers = {}
    this.ctx = null
    // Whether the CURRENT page wants BGM playing at all (kiosk/practice call
    // startBgm() on mount, the order page never does) - kept separate from
    // `enabled` so toggling sound off and back on resumes BGM only on a page
    // that actually asked for it, never starts it unprompted.
    this.bgmWanted = false
    this.bgmNode = null
  }

  subscribe(fn) {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  setEnabled(next) {
    this.enabled = next
    try {
      window.localStorage.setItem(STORAGE_KEY, next ? "1" : "0")
    } catch {
      // A kiosk browser with storage disabled still gets the in-memory toggle.
    }
    if (next) {
      this.ensure()
      if (this.bgmWanted) this.startBgm()
    } else {
      this.stopBgm({ keepWanted: true })
    }
    this.listeners.forEach((fn) => fn(next))
  }

  toggle() {
    this.setEnabled(!this.enabled)
  }

  ensure() {
    return neverThrows("ensure", () => {
      const Ctor = audioContextCtor()
      if (!Ctor) return null
      if (!this.ctx) {
        const ctx = new Ctor()
        // Two buses at the mockup's levels: .32 for the synth blips, .65 for
        // sample playback, so a reveal chime is not drowned by a click tone.
        this.master = ctx.createGain()
        this.master.gain.value = 0.32
        this.master.connect(ctx.destination)
        this.sfx = ctx.createGain()
        this.sfx.gain.value = 0.65
        this.sfx.connect(ctx.destination)
        // Quiet enough to sit under every tick/chime, never compete with them.
        this.bgm = ctx.createGain()
        this.bgm.gain.value = 0.22
        this.bgm.connect(ctx.destination)
        // Assigned only once the buses are wired, so a half-built context is
        // never cached and then reused as if it were ready.
        this.ctx = ctx
      }
      if (this.ctx.state === "suspended") this.ctx.resume()
      return this.ctx
    })
  }

  tone(freq, dur, type, vol) {
    neverThrows("tone", () => {
      if (!this.enabled) return
      const ctx = this.ensure()
      if (!ctx) return
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = type
      osc.frequency.value = freq
      gain.gain.value = 0
      osc.connect(gain)
      gain.connect(this.master)
      const t0 = ctx.currentTime
      gain.gain.linearRampToValueAtTime(vol, t0 + 0.015)
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
      osc.start(t0)
      osc.stop(t0 + dur + 0.05)
    })
  }

  click() {
    this.tone(680, 0.05, "square", 0.12)
  }

  // Decoded once into AudioBuffers: HTMLAudio.play() has 20-80ms of start
  // latency, which made the per-card ticks lag visibly behind the reel.
  loadBuffer(name) {
    return neverThrows("loadBuffer", () => {
      if (this.buffers[name] !== undefined) return this.buffers[name]
      const ctx = this.ensure()
      if (!ctx || typeof fetch !== "function") return null
      this.buffers[name] = null
      fetch(CLIP_BASE + name)
        .then((r) => r.arrayBuffer())
        .then((b) => new Promise((res, rej) => ctx.decodeAudioData(b, res, rej)))
        .then((buf) => {
          this.buffers[name] = buf
        })
        .catch((e) => console.warn("[gacha audio] không tải được", name, e?.message))
      return null
    })
  }

  preload() {
    neverThrows("preload", () => {
      if (!this.enabled) return
      CLIPS.forEach((n) => this.loadBuffer(n))
    })
  }

  play(name) {
    neverThrows("play", () => {
      if (!this.enabled) return
      if (typeof document !== "undefined" && document.hidden) return
      const ctx = this.ensure()
      if (!ctx) return
      const buf = this.loadBuffer(name)
      if (!buf || ctx.state !== "running") return
      const src = ctx.createBufferSource()
      src.buffer = buf
      src.connect(this.sfx)
      src.onended = () => src.disconnect()
      src.start()
    })
  }

  tick() {
    this.play("tick.mp3")
  }

  crateOpen() {
    this.play("opening.mp3")
  }

  chime(tier) {
    const i = TIER_ORDER.indexOf(tier)
    this.play(REVEAL_CLIPS[i] || REVEAL_CLIPS[0])
  }

  // Booth kiosk and the free practice page only - never the online order
  // page, which is an ordinary checkout flow, not a festival-stand
  // experience. `loadBuffer` decodes async and may not have the track ready
  // on the very first call right after mount; this retries a few times
  // rather than giving up on a call that just landed slightly too early.
  startBgm(attempt = 0) {
    neverThrows("startBgm", () => {
      this.bgmWanted = true
      if (this.bgmNode || !this.enabled) return
      const ctx = this.ensure()
      if (!ctx) return
      const buf = this.loadBuffer("bgm.mp3")
      if (!buf || ctx.state !== "running") {
        if (this.bgmWanted && attempt < 20) {
          setTimeout(() => this.startBgm(attempt + 1), 300)
        }
        return
      }
      const src = ctx.createBufferSource()
      src.buffer = buf
      src.loop = true
      src.connect(this.bgm)
      src.start()
      this.bgmNode = src
    })
  }

  stopBgm({ keepWanted = false } = {}) {
    neverThrows("stopBgm", () => {
      if (!keepWanted) this.bgmWanted = false
      if (this.bgmNode) {
        this.bgmNode.stop()
        this.bgmNode.disconnect()
        this.bgmNode = null
      }
    })
  }
}

export const gachaAudio = new GachaAudio()

export function useGachaSound() {
  const [enabled, setEnabled] = useState(gachaAudio.enabled)
  useEffect(() => gachaAudio.subscribe(setEnabled), [])
  return [enabled, () => gachaAudio.toggle()]
}

// Booth kiosk and practice page mount this once for their whole visit -
// ambient background music for the festival-stand experience. The online
// order page never calls this, so it never plays there.
export function useGachaBgm() {
  useEffect(() => {
    gachaAudio.startBgm()
    return () => gachaAudio.stopBgm()
  }, [])
}
