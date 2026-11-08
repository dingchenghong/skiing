type AudioWindow = Window & { webkitAudioContext?: typeof AudioContext }

/**
 * 全程序化合成的滑雪音效。
 * 风声 + 雪面细碎声是循环环境音，碰撞/观众欢呼是一次性合成音。
 */
class SkiAudio {
  private ctx: AudioContext | null = null
  private master: GainNode | null = null
  private ambience: GainNode | null = null
  private windSource: AudioBufferSourceNode | null = null
  private windFilter: BiquadFilterNode | null = null
  private windGain: GainNode | null = null
  private snowSource: AudioBufferSourceNode | null = null
  private snowFilter: BiquadFilterNode | null = null
  private snowGain: GainNode | null = null
  private carveSource: AudioBufferSourceNode | null = null
  private carveFilter: BiquadFilterNode | null = null
  private carveGain: GainNode | null = null
  private crowdSource: AudioBufferSourceNode | null = null
  private crowdFilter: BiquadFilterNode | null = null
  private crowdGain: GainNode | null = null
  private running = false
  private muted = false
  private lastUpdate = 0
  private lastCrowdUpdate = 0
  private paused = false

  ensure(): AudioContext | null {
    if (typeof window === 'undefined') return null
    if (!this.ctx) {
      const AudioCtor = window.AudioContext ?? (window as AudioWindow).webkitAudioContext
      if (!AudioCtor) return null
      this.ctx = new AudioCtor()
      this.master = this.ctx.createGain()
      this.master.gain.value = this.muted ? 0 : 0.8
      this.master.connect(this.ctx.destination)
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume()
    return this.ctx
  }

  setMuted(muted: boolean): void {
    this.muted = muted
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(muted ? 0 : 0.8, this.ctx.currentTime, 0.04)
    }
  }

  isMuted(): boolean {
    return this.muted
  }

  private noiseBuffer(seconds: number, smooth = 0.06, boost = 1.6): AudioBuffer | null {
    const ctx = this.ensure()
    if (!ctx) return null
    const length = Math.max(1, Math.floor(ctx.sampleRate * seconds))
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate)
    const data = buffer.getChannelData(0)
    let value = 0
    for (let i = 0; i < length; i++) {
      const white = Math.random() * 2 - 1
      value = value * (1 - smooth) + white * smooth
      data[i] = value * boost
    }
    return buffer
  }

  startAmbience(): void {
    const ctx = this.ensure()
    if (!ctx || !this.master) return
    if (this.running && this.ambience) return
    // 状态不一致（比如上一次节点创建失败）时允许重新初始化
    this.running = true
    this.paused = false

    this.ambience = ctx.createGain()
    this.ambience.gain.value = 0.5
    this.ambience.connect(this.master)

    const windBuffer = this.noiseBuffer(6, 0.035, 2.6)
    if (windBuffer) {
      this.windSource = ctx.createBufferSource()
      this.windSource.buffer = windBuffer
      this.windSource.loop = true
      this.windFilter = ctx.createBiquadFilter()
      this.windFilter.type = 'lowpass'
      this.windFilter.frequency.value = 420
      this.windFilter.Q.value = 0.8
      this.windGain = ctx.createGain()
      this.windGain.gain.value = 0.001
      this.windSource.connect(this.windFilter).connect(this.windGain).connect(this.ambience)
      this.windSource.start()
      this.windGain.gain.setTargetAtTime(0.0018, ctx.currentTime, 0.8)
    }

    const snowBuffer = this.noiseBuffer(4, 0.85, 0.5)
    if (snowBuffer) {
      this.snowSource = ctx.createBufferSource()
      this.snowSource.buffer = snowBuffer
      this.snowSource.loop = true
      this.snowFilter = ctx.createBiquadFilter()
      this.snowFilter.type = 'highpass'
      this.snowFilter.frequency.value = 1900
      this.snowGain = ctx.createGain()
      this.snowGain.gain.value = 0.018
      this.snowSource.connect(this.snowFilter).connect(this.snowGain).connect(this.ambience)
      this.snowSource.start()
    }

    const carveBuffer = this.noiseBuffer(2, 0.55, 0.45)
    if (carveBuffer) {
      this.carveSource = ctx.createBufferSource()
      this.carveSource.buffer = carveBuffer
      this.carveSource.loop = true
      this.carveFilter = ctx.createBiquadFilter()
      this.carveFilter.type = 'bandpass'
      this.carveFilter.frequency.value = 900
      this.carveFilter.Q.value = 0.9
      this.carveGain = ctx.createGain()
      this.carveGain.gain.value = 0.001
      this.carveSource.connect(this.carveFilter).connect(this.carveGain).connect(this.ambience)
      this.carveSource.start()
    }

    // 人群底噪：靠近观众时淡入，像真的有人在场边
    const crowdBuffer = this.noiseBuffer(5, 0.52, 0.75)
    if (crowdBuffer) {
      this.crowdSource = ctx.createBufferSource()
      this.crowdSource.buffer = crowdBuffer
      this.crowdSource.loop = true
      this.crowdFilter = ctx.createBiquadFilter()
      this.crowdFilter.type = 'bandpass'
      this.crowdFilter.frequency.value = 780
      this.crowdFilter.Q.value = 0.65
      this.crowdGain = ctx.createGain()
      this.crowdGain.gain.value = 0
      this.crowdSource.connect(this.crowdFilter).connect(this.crowdGain).connect(this.ambience)
      this.crowdSource.start()
    }
  }

  /** 0 ~ 1，表示离观众的远近 */
  updateCrowd(level: number): void {
    if (!this.ctx || !this.running) return
    const now = this.ctx.currentTime
    if (now - this.lastCrowdUpdate < 0.1) return
    this.lastCrowdUpdate = now
    const clamped = Math.max(0, Math.min(1, Number.isFinite(level) ? level : 0))
    this.crowdGain?.gain.setTargetAtTime(clamped * 0.055, now, 0.3)
  }

  updateAmbience(speed: number, carving: number): void {
    if (!this.ctx || !this.running) return
    const now = this.ctx.currentTime
    if (now - this.lastUpdate < 0.08) return
    this.lastUpdate = now
    const t = Math.min(1, speed / 40)
    this.windFilter?.frequency.setTargetAtTime(200 + t * 200, now, 0.25)
    this.windGain?.gain.setTargetAtTime(0.0014 + t * 0.0034, now, 0.3)
    this.snowGain?.gain.setTargetAtTime(0.0014 + t * 0.002, now, 0.3)
    this.carveFilter?.frequency.setTargetAtTime(700 + t * 900, now, 0.2)
    this.carveGain?.gain.setTargetAtTime(0.002 + carving * 0.012, now, 0.1)
  }

  setPaused(paused: boolean): void {
    this.paused = paused
    if (!this.ctx || !this.ambience) return
    this.ambience.gain.setTargetAtTime(paused ? 0.12 : 0.5, this.ctx.currentTime, 0.12)
  }

  stopAmbience(): void {
    if (!this.ctx || !this.ambience) {
      this.running = false
      return
    }
    const now = this.ctx.currentTime
    this.ambience.gain.setTargetAtTime(0.0001, now, 0.15)
    const nodes: (AudioBufferSourceNode | null)[] = [
      this.windSource,
      this.snowSource,
      this.carveSource,
      this.crowdSource,
    ]
    window.setTimeout(() => {
      nodes.forEach(node => {
        try {
          node?.stop()
        } catch {
          /* already stopped */
        }
      })
    }, 450)
    this.windSource = null
    this.windFilter = null
    this.windGain = null
    this.snowSource = null
    this.snowFilter = null
    this.snowGain = null
    this.carveSource = null
    this.carveFilter = null
    this.carveGain = null
    this.crowdSource = null
    this.crowdFilter = null
    this.crowdGain = null
    this.ambience = null
    this.running = false
  }

  ui(): void {
    const ctx = this.ensure()
    const master = this.master
    if (!ctx || !master) return
    const t = ctx.currentTime
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = 'sine'
    osc.frequency.setValueAtTime(620, t)
    osc.frequency.exponentialRampToValueAtTime(880, t + 0.08)
    gain.gain.setValueAtTime(0.0001, t)
    gain.gain.exponentialRampToValueAtTime(0.07, t + 0.01)
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.14)
    osc.connect(gain).connect(master)
    osc.start(t)
    osc.stop(t + 0.16)
  }

  countdown(): void {
    const ctx = this.ensure()
    if (!ctx || !this.master) return
    const t = ctx.currentTime
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = 'triangle'
    osc.frequency.setValueAtTime(440, t)
    osc.frequency.setValueAtTime(660, t + 0.16)
    gain.gain.setValueAtTime(0.0001, t)
    gain.gain.exponentialRampToValueAtTime(0.12, t + 0.02)
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.34)
    osc.connect(gain).connect(this.master)
    osc.start(t)
    osc.stop(t + 0.36)
  }

  jump(): void {
    const ctx = this.ensure()
    const master = this.master
    if (!ctx || !master) return
    const t = ctx.currentTime
    const buffer = this.noiseBuffer(0.42, 0.28, 0.9)
    if (buffer) {
      const noise = ctx.createBufferSource()
      noise.buffer = buffer
      const filter = ctx.createBiquadFilter()
      filter.type = 'bandpass'
      filter.frequency.setValueAtTime(520, t)
      filter.frequency.exponentialRampToValueAtTime(1500, t + 0.28)
      filter.Q.value = 0.8
      const gain = ctx.createGain()
      gain.gain.setValueAtTime(0.0001, t)
      gain.gain.exponentialRampToValueAtTime(0.15, t + 0.05)
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.36)
      noise.connect(filter).connect(gain).connect(master)
      noise.start(t)
    }

    const osc = ctx.createOscillator()
    const oscGain = ctx.createGain()
    osc.type = 'triangle'
    osc.frequency.setValueAtTime(210, t)
    osc.frequency.exponentialRampToValueAtTime(520, t + 0.22)
    oscGain.gain.setValueAtTime(0.0001, t)
    oscGain.gain.exponentialRampToValueAtTime(0.05, t + 0.04)
    oscGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.28)
    osc.connect(oscGain).connect(master)
    osc.start(t)
    osc.stop(t + 0.3)
  }

  land(): void {
    const ctx = this.ensure()
    const master = this.master
    if (!ctx || !master) return
    const t = ctx.currentTime
    const buffer = this.noiseBuffer(0.3, 0.6, 0.7)
    if (buffer) {
      const noise = ctx.createBufferSource()
      noise.buffer = buffer
      const filter = ctx.createBiquadFilter()
      filter.type = 'lowpass'
      filter.frequency.value = 900
      const gain = ctx.createGain()
      gain.gain.setValueAtTime(0.2, t)
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.3)
      noise.connect(filter).connect(gain).connect(master)
      noise.start(t)
    }

    const thud = ctx.createOscillator()
    const thudGain = ctx.createGain()
    thud.type = 'sine'
    thud.frequency.setValueAtTime(130, t)
    thud.frequency.exponentialRampToValueAtTime(46, t + 0.22)
    thudGain.gain.setValueAtTime(0.0001, t)
    thudGain.gain.exponentialRampToValueAtTime(0.16, t + 0.012)
    thudGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.28)
    thud.connect(thudGain).connect(master)
    thud.start(t)
    thud.stop(t + 0.3)
  }

  hit(kind: 'snowball' | 'rock' | 'tree' | 'log'): void {
    const ctx = this.ensure()
    if (!ctx || !this.master) return
    const t = ctx.currentTime
    const soft = kind === 'snowball'
    const thud = ctx.createOscillator()
    const thudGain = ctx.createGain()
    thud.type = 'sine'
    thud.frequency.setValueAtTime(soft ? 180 : 130, t)
    thud.frequency.exponentialRampToValueAtTime(soft ? 70 : 42, t + 0.22)
    const peak = soft ? 0.22 : 0.34
    thudGain.gain.setValueAtTime(0.0001, t)
    thudGain.gain.exponentialRampToValueAtTime(peak, t + 0.012)
    thudGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.3)
    thud.connect(thudGain).connect(this.master)
    thud.start(t)
    thud.stop(t + 0.32)

    const buffer = this.noiseBuffer(0.25, 0.3, 0.8)
    if (!buffer) return
    const noise = ctx.createBufferSource()
    noise.buffer = buffer
    const filter = ctx.createBiquadFilter()
    filter.type = soft ? 'lowpass' : 'bandpass'
    filter.frequency.value = soft ? 1300 : 760
    filter.Q.value = 0.7
    const gain = ctx.createGain()
    gain.gain.setValueAtTime(soft ? 0.18 : 0.26, t)
    gain.gain.exponentialRampToValueAtTime(0.0001, t + (soft ? 0.25 : 0.35))
    noise.connect(filter).connect(gain).connect(this.master)
    noise.start(t)
  }

  /** 观众反应：随机挑一种——掌声 / 喝彩 / 喊叫 / 尖叫 */
  cheer(): void {
    const roll = Math.random()
    if (roll < 0.3) this.applause()
    else if (roll < 0.55) this.cheerVoice()
    else if (roll < 0.75) this.shout()
    else this.scream()
  }

  /** 掌声：一串宽频噪声拍手 */
  private applause(): void {
    const ctx = this.ensure()
    if (!ctx || !this.master) return
    const t = ctx.currentTime
    const buffer = this.noiseBuffer(0.14, 0.5, 0.95)
    if (!buffer) return
    const claps = 7 + Math.floor(Math.random() * 5)
    for (let i = 0; i < claps; i++) {
      const noise = ctx.createBufferSource()
      noise.buffer = buffer
      const filter = ctx.createBiquadFilter()
      filter.type = 'bandpass'
      filter.frequency.value = 1300 + Math.random() * 1600
      filter.Q.value = 0.9
      const gain = ctx.createGain()
      const at = t + i * (0.05 + Math.random() * 0.045)
      gain.gain.setValueAtTime(0.0001, at)
      gain.gain.exponentialRampToValueAtTime(0.22 + Math.random() * 0.1, at + 0.006)
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.1)
      noise.connect(filter).connect(gain).connect(this.master)
      noise.start(at)
      noise.stop(at + 0.12)
    }
  }

  /** 喝彩：几声上扬的「喔——」 */
  private cheerVoice(): void {
    const ctx = this.ensure()
    if (!ctx || !this.master) return
    const t = ctx.currentTime
    const voices = 2 + Math.floor(Math.random() * 2)
    for (let i = 0; i < voices; i++) {
      const osc = ctx.createOscillator()
      osc.type = 'triangle'
      const base = 360 + i * 95 + Math.random() * 70
      const at = t + i * 0.05
      osc.frequency.setValueAtTime(base, at)
      osc.frequency.exponentialRampToValueAtTime(base * 1.9, at + 0.3)
      const gain = ctx.createGain()
      gain.gain.setValueAtTime(0.0001, at)
      gain.gain.exponentialRampToValueAtTime(0.1, at + 0.09)
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.5)
      osc.connect(gain).connect(this.master)
      osc.start(at)
      osc.stop(at + 0.55)
    }

    const buffer = this.noiseBuffer(0.6, 0.7, 0.85)
    if (!buffer) return
    const noise = ctx.createBufferSource()
    noise.buffer = buffer
    const filter = ctx.createBiquadFilter()
    filter.type = 'bandpass'
    filter.frequency.setValueAtTime(900, t)
    filter.frequency.linearRampToValueAtTime(1850, t + 0.4)
    filter.Q.value = 0.85
    const gain = ctx.createGain()
    gain.gain.setValueAtTime(0.0001, t)
    gain.gain.exponentialRampToValueAtTime(0.16, t + 0.08)
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.62)
    noise.connect(filter).connect(gain).connect(this.master)
    noise.start(t)
  }

  /** 喊叫：「冲啊——」 */
  private shout(): void {
    const ctx = this.ensure()
    if (!ctx || !this.master) return
    const t = ctx.currentTime
    const base = 230 + Math.random() * 95

    const osc = ctx.createOscillator()
    osc.type = 'sawtooth'
    osc.frequency.setValueAtTime(base, t)
    osc.frequency.linearRampToValueAtTime(base * 1.38, t + 0.24)
    osc.frequency.linearRampToValueAtTime(base * 0.98, t + 0.55)
    const formant = ctx.createBiquadFilter()
    formant.type = 'bandpass'
    formant.frequency.value = 1100
    formant.Q.value = 2.1
    const gain = ctx.createGain()
    gain.gain.setValueAtTime(0.0001, t)
    gain.gain.exponentialRampToValueAtTime(0.14, t + 0.05)
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.58)
    osc.connect(formant).connect(gain).connect(this.master)
    osc.start(t)
    osc.stop(t + 0.6)

    const buffer = this.noiseBuffer(0.4, 0.45, 0.75)
    if (!buffer) return
    const noise = ctx.createBufferSource()
    noise.buffer = buffer
    const filter = ctx.createBiquadFilter()
    filter.type = 'highpass'
    filter.frequency.value = 900
    const airGain = ctx.createGain()
    airGain.gain.setValueAtTime(0.0001, t)
    airGain.gain.exponentialRampToValueAtTime(0.1, t + 0.06)
    airGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.42)
    noise.connect(filter).connect(airGain).connect(this.master)
    noise.start(t)
  }

  /** 尖叫：「啊——」高亢上扬的多声部 */
  private scream(): void {
    const ctx = this.ensure()
    if (!ctx || !this.master) return
    const t = ctx.currentTime
    const base = 640 + Math.random() * 220
    const voices = 2 + Math.floor(Math.random() * 2)
    for (let i = 0; i < voices; i++) {
      const osc = ctx.createOscillator()
      osc.type = i === 0 ? 'sawtooth' : 'triangle'
      const start = t + i * 0.055
      const f0 = base + i * 130
      osc.frequency.setValueAtTime(f0 * 0.78, start)
      osc.frequency.exponentialRampToValueAtTime(f0 * 1.55, start + 0.16)
      osc.frequency.exponentialRampToValueAtTime(f0 * 1.05, start + 0.55)
      const formant = ctx.createBiquadFilter()
      formant.type = 'bandpass'
      formant.frequency.value = 1500 + i * 320
      formant.Q.value = 3.2
      const gain = ctx.createGain()
      gain.gain.setValueAtTime(0.0001, start)
      gain.gain.exponentialRampToValueAtTime(0.085, start + 0.06)
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.62)
      osc.connect(formant).connect(gain).connect(this.master)
      osc.start(start)
      osc.stop(start + 0.66)
    }
  }

  /** 摔倒时观众的抽气声「啊——」 */
  gasp(): void {
    const ctx = this.ensure()
    if (!ctx || !this.master) return
    const t = ctx.currentTime

    const buffer = this.noiseBuffer(0.5, 0.62, 0.75)
    if (buffer) {
      const noise = ctx.createBufferSource()
      noise.buffer = buffer
      const filter = ctx.createBiquadFilter()
      filter.type = 'bandpass'
      filter.frequency.setValueAtTime(1700, t)
      filter.frequency.exponentialRampToValueAtTime(520, t + 0.34)
      filter.Q.value = 1.5
      const gain = ctx.createGain()
      gain.gain.setValueAtTime(0.0001, t)
      gain.gain.exponentialRampToValueAtTime(0.22, t + 0.04)
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.42)
      noise.connect(filter).connect(gain).connect(this.master)
      noise.start(t)
    }

    const osc = ctx.createOscillator()
    osc.type = 'triangle'
    osc.frequency.setValueAtTime(540, t)
    osc.frequency.exponentialRampToValueAtTime(240, t + 0.3)
    const gain = ctx.createGain()
    gain.gain.setValueAtTime(0.0001, t)
    gain.gain.exponentialRampToValueAtTime(0.13, t + 0.03)
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.36)
    osc.connect(gain).connect(this.master)
    osc.start(t)
    osc.stop(t + 0.4)
  }

  /** 卡车鸣笛，提醒玩家有大家伙冲上来了 */
  horn(): void {
    const ctx = this.ensure()
    if (!ctx || !this.master) return
    const t = ctx.currentTime
    for (const [index, freq] of [220, 277].entries()) {
      const osc = ctx.createOscillator()
      osc.type = 'sawtooth'
      osc.frequency.setValueAtTime(freq, t)
      osc.detune.value = index === 0 ? -6 : 6
      const filter = ctx.createBiquadFilter()
      filter.type = 'lowpass'
      filter.frequency.value = 1900
      const gain = ctx.createGain()
      gain.gain.setValueAtTime(0.0001, t)
      gain.gain.exponentialRampToValueAtTime(0.06, t + 0.05)
      gain.gain.setValueAtTime(0.06, t + 0.42)
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.62)
      osc.connect(filter).connect(gain).connect(this.master)
      osc.start(t)
      osc.stop(t + 0.65)
    }
  }

  /** 吃到空中奖励的明亮琶音 */
  pickup(kind: 'snowflake' | 'bread' | 'icecream' | 'diamond' | 'shield'): void {
    const ctx = this.ensure()
    const master = this.master
    if (!ctx || !master) return
    const t = ctx.currentTime
    const notes =
      kind === 'diamond'
        ? [988, 1320, 1760]
        : kind === 'shield'
          ? [520, 780, 1040]
          : kind === 'icecream'
            ? [587, 784, 988]
            : kind === 'bread'
              ? [494, 660, 880]
              : [660, 990, 1320]
    notes.forEach((freq, index) => {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'triangle'
      const at = t + index * 0.055
      osc.frequency.setValueAtTime(freq, at)
      gain.gain.setValueAtTime(0.0001, at)
      gain.gain.exponentialRampToValueAtTime(0.13, at + 0.012)
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.22)
      osc.connect(gain).connect(master)
      osc.start(at)
      osc.stop(at + 0.24)
    })
  }

  milestone(): void {
    const ctx = this.ensure()
    const master = this.master
    if (!ctx || !master) return
    const t = ctx.currentTime
    const notes = [660, 880, 1180]
    notes.forEach((freq, index) => {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      const start = t + index * 0.07
      osc.frequency.setValueAtTime(freq, start)
      gain.gain.setValueAtTime(0.0001, start)
      gain.gain.exponentialRampToValueAtTime(0.055, start + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.26)
      osc.connect(gain).connect(master)
      osc.start(start)
      osc.stop(start + 0.28)
    })
  }
}

export const skiAudio = new SkiAudio()
