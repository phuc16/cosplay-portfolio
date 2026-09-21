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
    if (next) this.ensure()
    this.listeners.forEach((fn) => fn(next))
  }

  toggle() {
    this.setEnabled(!this.enabled)
  }

  ensure() {
    const Ctor = audioContextCtor()
    if (!Ctor) return null
    if (!this.ctx) {
      this.ctx = new Ctor()
      // Two buses at the mockup's levels: .32 for the synth blips, .65 for
      // sample playback, so a reveal chime is not drowned by a click tone.
      this.master = this.ctx.createGain()
      this.master.gain.value = 0.32
      this.master.connect(this.ctx.destination)
      this.sfx = this.ctx.createGain()
      this.sfx.gain.value = 0.65
      this.sfx.connect(this.ctx.destination)
    }
    if (this.ctx.state === "suspended") this.ctx.resume()
    return this.ctx
  }

  tone(freq, dur, type, vol) {
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
  }

  click() {
    this.tone(680, 0.05, "square", 0.12)
  }

  // Decoded once into AudioBuffers: HTMLAudio.play() has 20-80ms of start
  // latency, which made the per-card ticks lag visibly behind the reel.
  loadBuffer(name) {
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
  }

  preload() {
    if (!this.enabled) return
    CLIPS.forEach((n) => this.loadBuffer(n))
  }

  play(name) {
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
}

export const gachaAudio = new GachaAudio()

export function useGachaSound() {
  const [enabled, setEnabled] = useState(gachaAudio.enabled)
  useEffect(() => gachaAudio.subscribe(setEnabled), [])
  return [enabled, () => gachaAudio.toggle()]
}
