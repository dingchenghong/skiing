<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import { storeToRefs } from 'pinia'
import SkiCanvas from '@/components/SkiCanvas.vue'
import { JACKETS, type HudSnapshot, type RunResult } from '@/game/data'
import { skiAudio } from '@/game/audio'
import { useSkiStore } from '@/stores/ski'

type Phase = 'ready' | 'running' | 'paused' | 'over'
type Action = 'left' | 'right' | 'up' | 'down'
type Tone = 'good' | 'bad' | 'info'
type OrientationMode = 'auto' | 'landscape' | 'portrait'

const store = useSkiStore()
const { jacket, jacketId, best, muted } = storeToRefs(store)

const canvas = ref<InstanceType<typeof SkiCanvas> | null>(null)
const ready = ref(false)
const phase = ref<Phase>('ready')
const result = ref<RunResult | null>(null)
const newBest = ref(false)
const toast = ref<{ id: number; text: string; tone: Tone } | null>(null)
const jumpPressed = ref(false)
const touchState = reactive<Record<Action, boolean>>({ left: false, right: false, up: false, down: false })
const uiHidden = ref(false)
const joyActive = ref(false)
const joyPos = reactive({ x: 0, y: 0 })
const orientationMode = ref<OrientationMode>('auto')
const isPortrait = ref(false)
const hud = reactive<HudSnapshot>({
  score: 0,
  distance: 0,
  speed: 0,
  health: 100,
  slope: 0,
  hits: 0,
  best: 0,
  danger: 0,
  damageFlash: 0,
  airborne: false,
})

let toastId = 0
let toastTimer = 0

const numberFormat = new Intl.NumberFormat('zh-CN')
const scoreText = computed(() => numberFormat.format(hud.score))
const distanceText = computed(() => numberFormat.format(hud.distance))
const bestText = computed(() => numberFormat.format(best.value))
const healthColor = computed(() => (hud.health > 55 ? '#4ade80' : hud.health > 28 ? '#fbbf24' : '#fb7185'))
const speedPercent = computed(() => Math.min(100, Math.round((hud.speed / 190) * 100)))
const isTouchLayout = computed(
  () => joyActive.value || touchState.left || touchState.right || touchState.up || touchState.down,
)

const ORIENTATION_ORDER: OrientationMode[] = ['auto', 'landscape', 'portrait']
const ORIENTATION_LABELS: Record<OrientationMode, string> = {
  auto: '自动',
  landscape: '横屏',
  portrait: '竖屏',
}
const orientationLabel = computed(() => ORIENTATION_LABELS[orientationMode.value])
const rotationClass = computed(() => {
  if (orientationMode.value === 'landscape' && isPortrait.value) return 'rotate-cw'
  if (orientationMode.value === 'portrait' && !isPortrait.value) return 'rotate-ccw'
  return ''
})

function showToast(text: string, tone: Tone): void {
  toastId += 1
  toast.value = { id: toastId, text, tone }
  window.clearTimeout(toastTimer)
  toastTimer = window.setTimeout(() => {
    toast.value = null
  }, 1800)
}

function onReady(): void {
  ready.value = true
}

function onHud(next: HudSnapshot): void {
  Object.assign(hud, next, { best: best.value })
}

function onToast(payload: { text: string; tone: Tone }): void {
  showToast(payload.text, payload.tone)
}

function onGameOver(payload: RunResult): void {
  result.value = payload
  newBest.value = store.recordRun(payload.score)
  phase.value = 'over'
  resetTouch()
}

function start(): void {
  if (!ready.value) return
  skiAudio.ensure()
  skiAudio.ui()
  canvas.value?.start()
  phase.value = 'running'
  result.value = null
  newBest.value = false
  resetTouch()
}

function restart(): void {
  skiAudio.ensure()
  skiAudio.ui()
  canvas.value?.restart()
  phase.value = 'running'
  result.value = null
  newBest.value = false
  resetTouch()
}

function backToReady(): void {
  skiAudio.ui()
  canvas.value?.resetToReady()
  phase.value = 'ready'
  result.value = null
  newBest.value = false
  resetTouch()
}

function togglePause(): void {
  if (phase.value !== 'running' && phase.value !== 'paused') return
  const paused = canvas.value?.togglePause() ?? false
  phase.value = paused ? 'paused' : 'running'
  if (paused) resetTouch()
}

function quit(): void {
  skiAudio.ui()
  canvas.value?.quit()
  resetTouch()
}

function selectJacket(id: string): void {
  store.setJacket(id)
  skiAudio.ensure()
  skiAudio.ui()
}

function toggleMute(): void {
  skiAudio.ensure()
  store.setMuted(!muted.value)
  if (!muted.value) skiAudio.ui()
}

/** 任何一次交互都尝试唤醒音频，避免上下文因自动播放策略被挂起 */
function wakeAudio(): void {
  skiAudio.ensure()
}

function setAction(action: Action, pressed: boolean): void {
  if (touchState[action] === pressed) return
  touchState[action] = pressed
  canvas.value?.setTouch(action, pressed)
}

function clearActions(): void {
  ;(['left', 'right', 'up', 'down'] as Action[]).forEach(action => setAction(action, false))
}

function jumpPress(pressed: boolean, event?: PointerEvent): void {
  if (!pressed) {
    jumpPressed.value = false
    return
  }
  if (phase.value !== 'running') return
  if (event?.currentTarget instanceof HTMLElement) {
    try {
      event.currentTarget.setPointerCapture(event.pointerId)
    } catch {
      /* 部分嵌入环境不支持指针捕获 */
    }
  }
  jumpPressed.value = true
  skiAudio.ensure()
  canvas.value?.jump()
}

function resetTouch(): void {
  jumpPressed.value = false
  joyActive.value = false
  joyPos.x = 0
  joyPos.y = 0
  joyPointerId = -1
  canvas.value?.setSteer(0)
  clearActions()
}

/* ---------- 虚拟摇杆 ---------- */
/** 转向死区：轻微拨动不生效 */
const JOY_DEAD = 0.18
/** 加速 / 刹车的竖向死区 */
const THROTTLE_DEAD = 0.42

/** 死区外再做一次幂曲线，让“小幅度拨动”只给很小的转向量 */
function steerCurve(nx: number): number {
  const abs = Math.min(1, Math.abs(nx))
  if (abs <= JOY_DEAD) return 0
  const t = (abs - JOY_DEAD) / (1 - JOY_DEAD)
  return Math.sign(nx) * Math.pow(t, 1.55)
}

let joyPointerId = -1
let joyCenter = { x: 0, y: 0 }
let joyMax = 44

function joyDown(event: PointerEvent): void {
  if (phase.value !== 'running') return
  const el = event.currentTarget
  if (!(el instanceof HTMLElement)) return
  try {
    el.setPointerCapture(event.pointerId)
  } catch {
    /* 部分嵌入环境不支持指针捕获 */
  }
  joyPointerId = event.pointerId
  joyActive.value = true
  const rect = el.getBoundingClientRect()
  joyCenter = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
  joyMax = Math.max(26, Math.min(rect.width, rect.height) / 2 - 26)
  joyMove(event)
}

function joyMove(event: PointerEvent): void {
  if (!joyActive.value || event.pointerId !== joyPointerId) return
  let dx = event.clientX - joyCenter.x
  let dy = event.clientY - joyCenter.y
  const length = Math.hypot(dx, dy)
  if (length > joyMax) {
    dx = (dx / length) * joyMax
    dy = (dy / length) * joyMax
  }
  joyPos.x = dx
  joyPos.y = dy
  const nx = dx / joyMax
  const ny = dy / joyMax
  canvas.value?.setSteer(steerCurve(nx))
  setAction('up', ny < -THROTTLE_DEAD)
  setAction('down', ny > THROTTLE_DEAD)
}

function joyUp(event?: PointerEvent): void {
  if (event && event.pointerId !== joyPointerId) return
  joyActive.value = false
  joyPointerId = -1
  joyPos.x = 0
  joyPos.y = 0
  canvas.value?.setSteer(0)
  clearActions()
}

/* ---------- 轻点屏幕：只收起速度 / 体力面板 ---------- */
let tapStart: { x: number; y: number; time: number; id: number } | null = null

function toggleUi(): void {
  uiHidden.value = !uiHidden.value
  showToast(uiHidden.value ? '数据面板已收起 · 轻点屏幕恢复' : '数据面板已显示', 'info')
}

function onTapDown(event: PointerEvent): void {
  tapStart = null
  if (event.pointerType === 'mouse' || phase.value !== 'running') return
  if (event.target instanceof Element && event.target.closest('[data-ui]')) return
  tapStart = { x: event.clientX, y: event.clientY, time: performance.now(), id: event.pointerId }
}

function onTapUp(event: PointerEvent): void {
  const start = tapStart
  tapStart = null
  if (!start || start.id !== event.pointerId) return
  if (performance.now() - start.time > 320) return
  if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > 14) return
  toggleUi()
}

/* ---------- 横屏 / 竖屏切换 ---------- */
function syncViewportOrientation(): void {
  isPortrait.value = window.matchMedia('(orientation: portrait)').matches
}

function cycleOrientation(): void {
  const index = ORIENTATION_ORDER.indexOf(orientationMode.value)
  const next = ORIENTATION_ORDER[(index + 1) % ORIENTATION_ORDER.length] ?? 'auto'
  orientationMode.value = next
  skiAudio.ui()
  showToast(`屏幕方向：${ORIENTATION_LABELS[next]}`, 'info')
}

function onKeydown(event: KeyboardEvent): void {
  const target = event.target
  if (target instanceof HTMLElement && target.closest('input, textarea, select')) return
  if (event.code === 'Escape' || event.code === 'KeyP') {
    if (phase.value === 'running' || phase.value === 'paused') {
      event.preventDefault()
      togglePause()
    }
  } else if (event.code === 'KeyR' && phase.value === 'over') {
    event.preventDefault()
    restart()
  } else if (event.code === 'Enter') {
    if (phase.value === 'ready') {
      event.preventDefault()
      start()
    } else if (phase.value === 'over') {
      event.preventDefault()
      restart()
    }
  } else if (event.code === 'KeyM') {
    toggleMute()
  }
}

onMounted(() => {
  window.addEventListener('keydown', onKeydown)
  window.addEventListener('pointerdown', wakeAudio, { passive: true })
  skiAudio.setMuted(muted.value)
  syncViewportOrientation()
  window.addEventListener('resize', syncViewportOrientation)
  window.addEventListener('orientationchange', syncViewportOrientation)
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
  window.removeEventListener('pointerdown', wakeAudio)
  window.removeEventListener('resize', syncViewportOrientation)
  window.removeEventListener('orientationchange', syncViewportOrientation)
  window.clearTimeout(toastTimer)
})
</script>

<template>
  <div
    class="ski-game"
    :class="[rotationClass, { 'ui-hidden': uiHidden }]"
    :style="{ '--accent': jacket.color, '--accent-soft': jacket.accent }"
    @pointerdown="onTapDown"
    @pointerup="onTapUp"
  >
    <div class="stage">
      <SkiCanvas
        ref="canvas"
        :jacket="jacket"
        @ready="onReady"
        @hud="onHud"
        @toast="onToast"
        @gameover="onGameOver"
      />
    </div>

    <div class="vignette" />
    <div
      class="damage-flash"
      :style="{ opacity: Math.min(0.55, hud.damageFlash * 0.55) }"
    />
    <div class="speed-veil" :style="{ opacity: Math.max(0, Math.min(0.26, (hud.speed - 90) / 240)) }" />

    <Transition name="toast">
      <div v-if="toast && phase !== 'ready'" :key="toast.id" class="toast" :class="toast.tone">
        {{ toast.text }}
      </div>
    </Transition>

    <header v-if="phase !== 'ready'" class="hud-top" data-ui>
      <div class="brand-chip">
        <span class="brand-snow">❄</span>
        <div>
          <strong>雪道冲刺</strong>
          <small>POWDER RUSH</small>
        </div>
      </div>

      <div class="score-chip">
        <small>得分</small>
        <strong>{{ scoreText }}</strong>
        <span>最高 {{ bestText }}</span>
      </div>

      <div class="top-actions">
        <button
          class="icon-btn orient-btn"
          type="button"
          :aria-label="`屏幕方向：${orientationLabel}，点击切换`"
          :title="`屏幕方向：${orientationLabel}`"
          @click="cycleOrientation"
        >
          <span>{{ orientationLabel }}</span>
        </button>
        <button
          class="icon-btn"
          type="button"
          :aria-label="uiHidden ? '显示数据面板' : '收起数据面板'"
          @click="toggleUi"
        >
          <svg v-if="!uiHidden" class="eye" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M2.6 12S6.2 6.3 12 6.3 21.4 12 21.4 12 17.8 17.7 12 17.7 2.6 12 2.6 12Z" />
            <circle cx="12" cy="12" r="2.7" />
          </svg>
          <svg v-else class="eye" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M2.6 12S6.2 6.3 12 6.3 21.4 12 21.4 12 17.8 17.7 12 17.7 2.6 12 2.6 12Z" />
            <circle cx="12" cy="12" r="2.7" />
            <path d="M4.4 19.6 19.6 4.4" />
          </svg>
        </button>
        <button class="icon-btn" type="button" :aria-label="muted ? '打开声音' : '静音'" @click="toggleMute">
          {{ muted ? '🔇' : '🔊' }}
        </button>
        <button
          v-if="phase === 'running' || phase === 'paused'"
          class="icon-btn"
          type="button"
          :aria-label="phase === 'paused' ? '继续' : '暂停'"
          @click="togglePause"
        >
          {{ phase === 'paused' ? '▶' : '⏸' }}
        </button>
      </div>
    </header>

    <div v-if="phase !== 'ready'" class="hud-bottom" data-ui>
      <section class="stat-card speed-card" :class="{ air: hud.airborne }">
        <div class="stat-head">
          <span>速度</span>
          <span class="stat-tag">{{ hud.airborne ? '腾空' : `${hud.slope}° 坡度` }}</span>
        </div>
        <div class="speed-row">
          <strong>{{ hud.speed }}</strong>
          <span>km/h</span>
        </div>
        <div class="mini-track"><i :style="{ width: `${speedPercent}%` }" /></div>
        <div class="stat-foot">
          <span>距离 {{ distanceText }} m</span>
          <span>受伤 {{ hud.hits }} 次</span>
        </div>
      </section>

      <section class="stat-card health-card" :class="{ low: hud.health <= 30, critical: hud.health <= 15 }">
        <div class="stat-head">
          <span>体力</span>
          <span>{{ hud.health }}%</span>
        </div>
        <div class="health-track">
          <i :style="{ width: `${Math.max(0, hud.health)}%`, background: healthColor }" />
        </div>
        <p class="health-hint">
          {{ hud.health <= 30 ? '体力告急，稳住！' : '撞到雪团、岩石会掉体力并扣分' }}
        </p>
        <div class="key-hint">← → 控向 <b>·</b> ↑ ↓ 调速 <b>·</b> Space 跳 <b>·</b> Esc 暂停</div>
      </section>
    </div>

    <div v-if="phase === 'running'" class="touch-controls" :class="{ active: isTouchLayout }" data-ui>
      <div class="joy-wrap">
        <div
          class="joy"
          :class="{ engaged: joyActive }"
          role="slider"
          aria-label="方向摇杆"
          @pointerdown.prevent="joyDown"
          @pointermove.prevent="joyMove"
          @pointerup.prevent="joyUp"
          @pointercancel.prevent="joyUp"
          @lostpointercapture="joyUp"
        >
          <span class="joy-arm n" />
          <span class="joy-arm s" />
          <span class="joy-arm w" />
          <span class="joy-arm e" />
          <span class="joy-core" />
          <span class="joy-knob" :style="{ transform: `translate(${joyPos.x}px, ${joyPos.y}px)` }" />
        </div>
        <small class="joy-label">{{ joyActive ? '滑动中' : '左右滑动 / 上推加速' }}</small>
      </div>

      <button
        type="button"
        class="jump-pad"
        :class="{ pressed: jumpPressed }"
        aria-label="跳跃"
        @pointerdown.prevent="jumpPress(true, $event)"
        @pointerup.prevent="jumpPress(false)"
        @pointercancel.prevent="jumpPress(false)"
        @lostpointercapture="jumpPress(false)"
      >
        <span class="pad-well">
          <span class="pad-cap" />
        </span>
      </button>
    </div>

    <Transition name="panel">
      <section v-if="phase === 'ready'" class="start-overlay">
        <div class="start-card">
          <div class="eyebrow"><span class="pulse-dot" /> ALPINE ARCADE · 3D 滑雪</div>
          <h1>雪道冲刺</h1>
          <p class="title-en">POWDER RUSH</p>
          <p class="intro">
            从雪山顶一路冲下去。左右控向，前后调速，避开雪团、岩石和倒木。
            雪道偶尔会分叉，还会冒出别的滑雪者，偶尔甚至有一辆卡车冲上雪道。
            空中飘着的面包、钻石和护盾要跳起来才吃得到；剪刀、冰锥、石块碰不得。
          </p>

          <div class="picker">
            <div class="picker-head">
              <span>滑雪服颜色</span>
              <strong>{{ jacket.name }}</strong>
            </div>
            <div class="swatches" role="radiogroup" aria-label="滑雪服颜色">
              <button
                v-for="item in JACKETS"
                :key="item.id"
                type="button"
                class="swatch"
                :class="{ active: item.id === jacketId }"
                :style="{ '--swatch': item.color }"
                :aria-label="item.name"
                :aria-checked="item.id === jacketId"
                role="radio"
                @click="selectJacket(item.id)"
              >
                <span />
              </button>
            </div>
          </div>

          <div class="controls-grid">
            <div class="control-item">
              <div class="keys"><kbd>←</kbd><kbd>→</kbd></div>
              <span>左右转向</span>
            </div>
            <div class="control-item">
              <div class="keys"><kbd>↑</kbd><kbd>↓</kbd></div>
              <span>加速 / 刹车</span>
            </div>
            <div class="control-item">
              <div class="keys"><kbd>Space</kbd></div>
              <span>大跳 / 越过障碍</span>
            </div>
            <div class="control-item">
              <div class="keys"><kbd>Esc</kbd></div>
              <span>暂停</span>
            </div>
            <div class="control-item touch-note">
              <div class="keys"><kbd>摇杆</kbd><kbd>跳</kbd></div>
              <span>手机：左手滑动控向，右手轻点起跳，轻点屏幕可收起数据面板</span>
            </div>
          </div>

          <button class="primary-btn" type="button" :disabled="!ready" @click="start">
            <span>{{ ready ? '开始下滑' : '正在准备雪道…' }}</span>
            <b>→</b>
          </button>

          <div class="start-foot">
            <span>🏔 无限雪道 · 随机坡度</span>
            <span>⭐ 每 250 m 额外加分</span>
            <span>🏆 最高 {{ bestText }}</span>
          </div>
        </div>

        <div class="corner-fabs">
          <button
            class="icon-btn orient-btn"
            type="button"
            :aria-label="`屏幕方向：${orientationLabel}，点击切换`"
            @click="cycleOrientation"
          >
            <span>{{ orientationLabel }}</span>
          </button>
          <button class="sound-fab" type="button" :aria-label="muted ? '打开声音' : '静音'" @click="toggleMute">
            {{ muted ? '🔇' : '🔊' }}
          </button>
        </div>
      </section>
    </Transition>

    <Transition name="panel">
      <section v-if="phase === 'paused'" class="modal-overlay">
        <div class="modal-card small">
          <div class="eyebrow"><span class="pulse-dot" /> 山风暂停了</div>
          <h2>暂停中</h2>
          <p class="modal-copy">喘口气，看看坡下的路线。</p>
          <div class="pause-stats">
            <div><small>得分</small><strong>{{ scoreText }}</strong></div>
            <div><small>距离</small><strong>{{ distanceText }} m</strong></div>
            <div><small>体力</small><strong>{{ hud.health }}%</strong></div>
          </div>
          <button class="primary-btn" type="button" @click="togglePause"><span>继续下滑</span><b>▶</b></button>
          <div class="modal-actions">
            <button class="ghost-btn" type="button" @click="restart">重新开始</button>
            <button class="ghost-btn danger" type="button" @click="quit">结束本局</button>
          </div>
        </div>
      </section>
    </Transition>

    <Transition name="panel">
      <section v-if="phase === 'over' && result" class="modal-overlay">
        <div class="modal-card result-card">
          <div class="eyebrow">
            <span class="pulse-dot" />
            {{ result.reason === 'health' ? '体力耗尽 · 摔进雪堆' : '主动结束 · 这趟滑完了' }}
          </div>
          <h2>{{ result.reason === 'health' ? '雪地翻车！' : '安全抵达' }}</h2>
          <p class="modal-copy">
            {{ newBest ? '刷新个人纪录，山风都在为你欢呼。' : '再滑一趟，把雪团和岩石都甩在身后。' }}
          </p>
          <div v-if="newBest" class="new-best">★ 新纪录 · NEW BEST</div>

          <div class="result-score">
            <small>本局得分</small>
            <strong>{{ numberFormat.format(result.score) }}</strong>
            <span>最高 {{ bestText }}</span>
          </div>

          <div class="result-grid">
            <div><small>滑行距离</small><strong>{{ numberFormat.format(result.distance) }} m</strong></div>
            <div><small>最高速度</small><strong>{{ Math.round(result.maxSpeed * 3.6) }} km/h</strong></div>
            <div><small>受伤次数</small><strong>{{ result.hits }} 次</strong></div>
            <div><small>滑雪服</small><strong>{{ jacket.name }}</strong></div>
          </div>

          <button class="primary-btn" type="button" @click="restart"><span>再滑一次</span><b>↻</b></button>
          <div class="modal-actions">
            <button class="ghost-btn" type="button" @click="backToReady">回到起点</button>
            <button class="ghost-btn" type="button" @click="toggleMute">{{ muted ? '打开声音' : '静音' }}</button>
          </div>
        </div>
      </section>
    </Transition>
  </div>
</template>

<style scoped>
.ski-game {
  position: fixed;
  inset: 0;
  overflow: hidden;
  color: #f4fbff;
  background: #dfeaf7;
  touch-action: none;
  user-select: none;
  font-family: 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', system-ui, sans-serif;
}

.stage {
  position: absolute;
  inset: 0;
}

.vignette {
  position: absolute;
  inset: 0;
  pointer-events: none;
  background:
    radial-gradient(ellipse at 50% 45%, transparent 46%, rgba(7, 20, 35, 0.32) 100%),
    linear-gradient(180deg, rgba(4, 17, 30, 0.28), transparent 22%, transparent 72%, rgba(4, 17, 30, 0.5));
}

.damage-flash {
  position: absolute;
  inset: 0;
  pointer-events: none;
  background: radial-gradient(circle at 50% 50%, rgba(255, 92, 92, 0) 28%, rgba(255, 48, 70, 0.55) 100%);
  transition: opacity 120ms linear;
  z-index: 8;
}

.speed-veil {
  position: absolute;
  inset: 0;
  pointer-events: none;
  background: repeating-conic-gradient(
    from 0deg at 50% 50%,
    transparent 0deg 14deg,
    rgba(226, 245, 255, 0.15) 14deg 14.5deg,
    transparent 14.5deg 30deg
  );
  mask-image: radial-gradient(ellipse at 50% 50%, transparent 42%, #000 100%);
  transition: opacity 300ms linear;
  z-index: 2;
}

.hud-top {
  position: absolute;
  top: 20px;
  left: 20px;
  right: 20px;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  pointer-events: none;
  z-index: 10;
  transition: opacity 220ms ease, transform 220ms ease;
}

.brand-chip,
.score-chip,
.stat-card {
  border: 1px solid rgba(196, 234, 255, 0.2);
  background: linear-gradient(150deg, rgba(8, 27, 44, 0.82), rgba(9, 20, 33, 0.66));
  box-shadow: 0 18px 45px rgba(4, 15, 27, 0.3), inset 0 1px 0 rgba(255, 255, 255, 0.08);
  backdrop-filter: blur(14px);
}

.brand-chip {
  display: flex;
  align-items: center;
  gap: 11px;
  padding: 10px 15px 10px 12px;
  border-radius: 15px;
}

.brand-snow {
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  border-radius: 11px;
  background: linear-gradient(145deg, var(--accent), rgba(255, 255, 255, 0.35));
  color: #061522;
  font-size: 20px;
  box-shadow: 0 8px 20px color-mix(in srgb, var(--accent) 45%, transparent);
}

.brand-chip strong {
  display: block;
  font-size: 14px;
  letter-spacing: 0.12em;
}

.brand-chip small {
  display: block;
  margin-top: 2px;
  color: #8db4cf;
  font-size: 9px;
  letter-spacing: 0.22em;
}

.score-chip {
  position: absolute;
  left: 50%;
  transform: translateX(-50%);
  min-width: 176px;
  padding: 9px 24px 10px;
  border-radius: 18px;
  text-align: center;
}

.score-chip small {
  display: block;
  color: #9ec5de;
  font-size: 10px;
  letter-spacing: 0.22em;
}

.score-chip strong {
  display: block;
  margin: 1px 0 0;
  font-size: clamp(26px, 3.4vw, 38px);
  line-height: 1;
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.02em;
  text-shadow: 0 0 24px color-mix(in srgb, var(--accent) 35%, transparent);
}

.score-chip span {
  display: block;
  margin-top: 4px;
  color: #7eabc8;
  font-size: 10px;
  letter-spacing: 0.08em;
}

.top-actions {
  display: flex;
  gap: 8px;
  pointer-events: auto;
}

.icon-btn,
.sound-fab {
  display: grid;
  place-items: center;
  width: 42px;
  height: 42px;
  border: 1px solid rgba(196, 234, 255, 0.22);
  border-radius: 13px;
  background: rgba(8, 27, 44, 0.78);
  color: #eaf7ff;
  font-size: 17px;
  cursor: pointer;
  backdrop-filter: blur(12px);
  transition: transform 160ms ease, background 160ms ease;
}

.icon-btn:hover,
.sound-fab:hover {
  transform: translateY(-1px);
  background: rgba(18, 47, 72, 0.9);
}

.icon-btn .eye {
  width: 19px;
  height: 19px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.7;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.orient-btn span {
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.04em;
}

.hud-bottom {
  position: absolute;
  left: 20px;
  right: 20px;
  bottom: 20px;
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 16px;
  pointer-events: none;
  z-index: 10;
  transition: opacity 220ms ease, transform 220ms ease;
}

/* 轻点屏幕：只收起速度 / 体力两张面板，摇杆和跳键始终保留 */
.ski-game.ui-hidden .hud-bottom {
  opacity: 0;
  transform: translateY(12px);
  pointer-events: none;
}

/* 横屏 / 竖屏切换（CSS 旋转兜底） */
.ski-game.rotate-cw,
.ski-game.rotate-ccw {
  right: auto;
  bottom: auto;
  left: 0;
  top: 0;
  width: 100vh;
  height: 100vw;
  transform-origin: top left;
}

.ski-game.rotate-cw {
  transform: translate(100vw, 0) rotate(90deg);
}

.ski-game.rotate-ccw {
  transform: translate(0, 100vh) rotate(-90deg);
}

.stat-card {
  width: min(264px, 32vw);
  padding: 13px 16px 12px;
  border-radius: 17px;
}

.stat-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  color: #a8cde4;
  font-size: 11px;
  letter-spacing: 0.12em;
}

.stat-tag {
  color: #7da9c2;
  font-size: 10px;
  letter-spacing: 0.04em;
}

.speed-row {
  display: flex;
  align-items: baseline;
  gap: 7px;
  margin-top: 2px;
}

.speed-row strong {
  font-size: 38px;
  line-height: 1;
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.03em;
}

.speed-row span {
  color: #82a9c1;
  font-size: 11px;
  letter-spacing: 0.08em;
}

.mini-track,
.health-track {
  position: relative;
  overflow: hidden;
  height: 6px;
  margin-top: 8px;
  border-radius: 99px;
  background: rgba(177, 219, 242, 0.16);
}

.mini-track i {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: linear-gradient(90deg, #49d7ff, var(--accent));
  box-shadow: 0 0 12px color-mix(in srgb, var(--accent) 60%, transparent);
  transition: width 200ms linear;
}

.stat-foot {
  display: flex;
  justify-content: space-between;
  margin-top: 7px;
  color: #87aec6;
  font-size: 10px;
}

.health-card {
  text-align: right;
}

.health-card .stat-head {
  color: #b6d6e9;
}

.health-card .stat-head span:last-child {
  color: #e8f8ff;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}

.health-track {
  height: 8px;
}

.health-track i {
  display: block;
  height: 100%;
  border-radius: inherit;
  transition: width 240ms ease, background 240ms ease;
}

.health-hint {
  margin: 8px 0 0;
  color: #83acc4;
  font-size: 10px;
  line-height: 1.5;
}

.key-hint {
  margin-top: 7px;
  color: #5f8aa4;
  font-size: 9px;
  letter-spacing: 0.04em;
}

.key-hint b {
  margin: 0 4px;
  color: #3e647c;
}

.speed-card.air {
  border-color: color-mix(in srgb, var(--accent) 52%, transparent);
  box-shadow: 0 18px 45px rgba(4, 15, 27, 0.3), 0 0 22px color-mix(in srgb, var(--accent) 16%, transparent), inset 0 1px 0 rgba(255, 255, 255, 0.1);
}

.speed-card.air .stat-tag {
  color: var(--accent-soft);
  font-weight: 800;
  letter-spacing: 0.12em;
}

.speed-card.air .speed-row strong {
  color: #ffffff;
  text-shadow: 0 0 20px color-mix(in srgb, var(--accent) 45%, transparent);
}

.health-card.low .health-hint {
  color: #ffd166;
}

.health-card.critical {
  border-color: rgba(255, 107, 129, 0.45);
  animation: critical-pulse 1.1s ease-in-out infinite;
}

@keyframes critical-pulse {
  0%,
  100% {
    box-shadow: 0 18px 45px rgba(4, 15, 27, 0.3), inset 0 1px 0 rgba(255, 255, 255, 0.08);
  }
  50% {
    box-shadow: 0 0 0 1px rgba(255, 92, 115, 0.25), 0 12px 38px rgba(255, 54, 82, 0.18);
  }
}

.toast {
  position: absolute;
  top: 118px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 22;
  max-width: min(88vw, 620px);
  padding: 10px 20px;
  border: 1px solid rgba(191, 232, 255, 0.24);
  border-radius: 999px;
  background: rgba(7, 22, 37, 0.8);
  color: #e8f8ff;
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 0.01em;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  box-shadow: 0 14px 35px rgba(3, 13, 24, 0.35);
  backdrop-filter: blur(14px);
  pointer-events: none;
}

.toast.good {
  border-color: rgba(89, 229, 174, 0.3);
  color: #b8ffe0;
}

.toast.bad {
  border-color: rgba(255, 123, 143, 0.38);
  color: #ffd3da;
}

.toast.info {
  border-color: color-mix(in srgb, var(--accent) 40%, transparent);
  color: #e7f7ff;
}

.toast-enter-active,
.toast-leave-active {
  transition: opacity 220ms ease, transform 220ms ease;
}

.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translate(-50%, -8px);
}

.touch-controls {
  position: absolute;
  left: 0;
  right: 0;
  bottom: calc(14px + env(safe-area-inset-bottom));
  z-index: 14;
  display: none;
  align-items: flex-end;
  justify-content: space-between;
  padding: 0 18px;
  pointer-events: none;
  transition: opacity 220ms ease, transform 220ms ease;
}

.touch-controls > * {
  pointer-events: auto;
}

.touch-controls.active {
  opacity: 1;
}

.joy-wrap {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 7px;
}

.joy {
  position: relative;
  width: 132px;
  height: 132px;
  border: 1.5px solid rgba(210, 240, 255, 0.3);
  border-radius: 50%;
  background: radial-gradient(circle at 50% 45%, rgba(10, 32, 52, 0.34), rgba(7, 22, 37, 0.14));
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.1), 0 14px 34px rgba(4, 15, 27, 0.22);
  backdrop-filter: blur(8px);
  opacity: 0.62;
  touch-action: none;
  transition: opacity 160ms ease, border-color 160ms ease, box-shadow 160ms ease;
}

.joy.engaged {
  opacity: 1;
  border-color: color-mix(in srgb, var(--accent) 55%, rgba(255, 255, 255, 0.35));
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.16), 0 0 26px color-mix(in srgb, var(--accent) 22%, transparent);
}

.joy-arm {
  position: absolute;
  width: 2px;
  height: 13px;
  border-radius: 2px;
  background: rgba(216, 242, 255, 0.45);
}

.joy-arm.n {
  top: 7px;
  left: 50%;
  transform: translateX(-50%);
}

.joy-arm.s {
  bottom: 7px;
  left: 50%;
  transform: translateX(-50%);
}

.joy-arm.w {
  left: 7px;
  top: 50%;
  width: 13px;
  height: 2px;
  transform: translateY(-50%);
}

.joy-arm.e {
  right: 7px;
  top: 50%;
  width: 13px;
  height: 2px;
  transform: translateY(-50%);
}

.joy-core {
  position: absolute;
  inset: 26px;
  border: 1px solid rgba(214, 240, 255, 0.24);
  border-radius: 50%;
  background: rgba(8, 26, 42, 0.2);
  pointer-events: none;
}

.joy-knob {
  position: absolute;
  top: 50%;
  left: 50%;
  width: 58px;
  height: 58px;
  margin: -29px 0 0 -29px;
  border: 1px solid color-mix(in srgb, var(--accent) 55%, rgba(255, 255, 255, 0.5));
  border-radius: 50%;
  background: radial-gradient(circle at 34% 28%, rgba(255, 255, 255, 0.42), color-mix(in srgb, var(--accent) 62%, rgba(8, 26, 42, 0.55)));
  box-shadow: 0 10px 24px rgba(4, 15, 27, 0.38), inset 0 1px 0 rgba(255, 255, 255, 0.5);
  opacity: 0.78;
  pointer-events: none;
  transition: transform 140ms cubic-bezier(0.2, 0.8, 0.3, 1), opacity 140ms ease;
}

.joy.engaged .joy-knob {
  opacity: 1;
  transition: opacity 120ms ease;
}

.joy-label {
  color: rgba(206, 234, 250, 0.6);
  font-size: 9px;
  letter-spacing: 0.08em;
  white-space: nowrap;
}

.jump-pad {
  position: relative;
  display: grid;
  place-items: center;
  width: 104px;
  height: 104px;
  font-size: 104px;
  margin-bottom: 4px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: radial-gradient(
    circle at 50% 58%,
    rgba(4, 14, 26, 0.4) 0%,
    rgba(5, 18, 32, 0.24) 62%,
    rgba(150, 205, 235, 0.16) 74%,
    rgba(150, 205, 235, 0.05) 100%
  );
  box-shadow:
    inset 0 0 0 1.5px rgba(196, 234, 255, 0.3),
    inset 0 10px 20px rgba(3, 14, 26, 0.36),
    0 16px 32px rgba(4, 15, 27, 0.22);
  backdrop-filter: blur(8px);
  opacity: 0.8;
  cursor: pointer;
  touch-action: none;
  -webkit-tap-highlight-color: transparent;
  transition: opacity 160ms ease;
}

.jump-pad.pressed,
.jump-pad:active {
  opacity: 1;
}

/* 凹槽：按键嵌在里面 */
.pad-well {
  position: relative;
  display: grid;
  place-items: center;
  width: 0.615em;
  height: 0.615em;
  border-radius: 50%;
  background: radial-gradient(circle at 50% 32%, rgba(2, 10, 19, 0.5), rgba(6, 20, 34, 0.34));
  box-shadow:
    inset 0 6px 12px rgba(2, 10, 19, 0.55),
    inset 0 -1px 0 rgba(255, 255, 255, 0.12),
    0 1px 0 rgba(255, 255, 255, 0.14);
  pointer-events: none;
}

/* 有体积感的小按钮：平时凸起，按下真正沉入凹槽 */
.pad-cap {
  position: relative;
  width: 0.52em;
  height: 0.52em;
  border-radius: 50%;
  background:
    radial-gradient(circle at 42% 24%, rgba(255, 255, 255, 0.7), rgba(255, 255, 255, 0) 48%),
    linear-gradient(
      180deg,
      color-mix(in srgb, var(--accent-soft) 92%, #ffffff) 0%,
      var(--accent) 55%,
      color-mix(in srgb, var(--accent) 62%, #05121f) 100%
    );
  box-shadow:
    0 0.05em 0 color-mix(in srgb, var(--accent) 36%, #05121f),
    0 0.09em 0.16em rgba(4, 15, 27, 0.42),
    inset 0 2px 1px rgba(255, 255, 255, 0.62),
    inset 0 -8px 14px rgba(3, 14, 26, 0.26);
  transition: transform 80ms cubic-bezier(0.3, 0.9, 0.4, 1), box-shadow 80ms ease, filter 80ms ease;
  will-change: transform;
}

.pad-cap::after {
  content: '';
  position: absolute;
  inset: 17%;
  border-radius: 50%;
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.22);
}

.jump-pad.pressed .pad-cap,
.jump-pad:active .pad-cap {
  transform: translateY(0.05em) scale(0.99);
  filter: brightness(1.08);
  box-shadow:
    0 0 0 color-mix(in srgb, var(--accent) 34%, #05121f),
    0 0.03em 0.08em rgba(4, 15, 27, 0.35),
    inset 0 3px 8px rgba(3, 14, 26, 0.45),
    inset 0 1px 0 rgba(255, 255, 255, 0.24);
}

.jump-pad.pressed .pad-cap::after,
.jump-pad:active .pad-cap::after {
  opacity: 0.5;
}

.start-overlay,
.modal-overlay {
  position: absolute;
  inset: 0;
  z-index: 30;
  display: flex;
  align-items: center;
  padding: 28px clamp(18px, 6vw, 92px);
}

.start-overlay {
  justify-content: flex-start;
  background:
    radial-gradient(ellipse at 18% 48%, rgba(4, 17, 30, 0.66), transparent 55%),
    linear-gradient(90deg, rgba(3, 14, 26, 0.72) 0%, rgba(3, 14, 26, 0.22) 48%, transparent 78%);
}

.start-card {
  width: min(520px, 100%);
  max-height: calc(100vh - 56px);
  overflow-y: auto;
  padding: clamp(24px, 3.4vw, 38px);
  border: 1px solid rgba(192, 233, 255, 0.23);
  border-radius: 28px;
  background:
    linear-gradient(155deg, rgba(7, 25, 43, 0.9), rgba(5, 16, 29, 0.82)),
    radial-gradient(circle at 80% 0%, color-mix(in srgb, var(--accent) 25%, transparent), transparent 55%);
  box-shadow: 0 40px 100px rgba(2, 12, 23, 0.55), inset 0 1px 0 rgba(255, 255, 255, 0.1);
  backdrop-filter: blur(18px);
  scrollbar-width: thin;
}

.eyebrow {
  display: flex;
  align-items: center;
  gap: 8px;
  color: #90bad3;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.2em;
  text-transform: uppercase;
}

.pulse-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--accent);
  box-shadow: 0 0 0 4px color-mix(in srgb, var(--accent) 20%, transparent);
  animation: dot-pulse 1.8s ease-in-out infinite;
}

@keyframes dot-pulse {
  0%,
  100% {
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 18%, transparent);
  }
  50% {
    box-shadow: 0 0 0 7px color-mix(in srgb, var(--accent) 4%, transparent);
  }
}

.start-card h1 {
  margin: 16px 0 0;
  color: #f7fcff;
  font-size: clamp(48px, 6.6vw, 76px);
  font-weight: 900;
  line-height: 0.94;
  letter-spacing: -0.06em;
  text-shadow: 0 0 44px color-mix(in srgb, var(--accent) 28%, transparent);
}

.title-en {
  margin: 8px 0 0;
  color: var(--accent);
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.42em;
}

.intro {
  margin: 17px 0 0;
  max-width: 420px;
  color: #aac9dc;
  font-size: 13px;
  line-height: 1.75;
}

.picker {
  margin-top: 22px;
  padding: 13px 15px 14px;
  border: 1px solid rgba(180, 224, 248, 0.14);
  border-radius: 16px;
  background: rgba(4, 17, 30, 0.45);
}

.picker-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  color: #85b2cb;
  font-size: 11px;
  letter-spacing: 0.1em;
}

.picker-head strong {
  color: var(--accent-soft);
  font-size: 12px;
  letter-spacing: 0.04em;
}

.swatches {
  display: flex;
  gap: 11px;
  margin-top: 11px;
}

.swatch {
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  padding: 0;
  border: 2px solid transparent;
  border-radius: 50%;
  background: transparent;
  cursor: pointer;
  transition: transform 160ms ease, border-color 160ms ease;
}

.swatch span {
  display: block;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  background: var(--swatch);
  box-shadow: 0 5px 14px color-mix(in srgb, var(--swatch) 40%, transparent);
}

.swatch:hover {
  transform: translateY(-2px);
}

.swatch.active {
  border-color: var(--accent-soft);
  transform: scale(1.06);
}

.controls-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 8px;
  margin-top: 16px;
}

.control-item {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 38px;
  padding: 7px 10px;
  border-radius: 11px;
  background: rgba(127, 184, 219, 0.07);
  color: #8fb7cf;
  font-size: 11px;
}

.keys {
  display: flex;
  gap: 4px;
}

kbd {
  display: grid;
  place-items: center;
  min-width: 23px;
  height: 24px;
  padding: 0 5px;
  border: 1px solid rgba(192, 232, 255, 0.22);
  border-bottom-width: 2px;
  border-radius: 6px;
  background: rgba(8, 27, 44, 0.8);
  color: #d9f1ff;
  font-family: inherit;
  font-size: 11px;
  font-weight: 700;
}

.primary-btn {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  min-height: 54px;
  margin-top: 20px;
  padding: 0 18px 0 22px;
  border: 0;
  border-radius: 15px;
  background: linear-gradient(105deg, var(--accent), color-mix(in srgb, var(--accent) 62%, #ffffff));
  color: #061421;
  font-size: 15px;
  font-weight: 900;
  letter-spacing: 0.06em;
  cursor: pointer;
  box-shadow: 0 16px 36px color-mix(in srgb, var(--accent) 28%, transparent), inset 0 1px 0 rgba(255, 255, 255, 0.45);
  transition: transform 160ms ease, filter 160ms ease;
}

.primary-btn b {
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  border-radius: 10px;
  background: rgba(3, 16, 27, 0.16);
  font-size: 18px;
}

.primary-btn:hover:not(:disabled) {
  transform: translateY(-2px);
  filter: brightness(1.06);
}

.primary-btn:disabled {
  cursor: wait;
  filter: grayscale(0.4) brightness(0.8);
}

.start-foot {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 16px;
  margin-top: 14px;
  color: #6f9bb5;
  font-size: 10px;
}

.corner-fabs {
  position: absolute;
  top: 22px;
  right: 22px;
  display: flex;
  gap: 8px;
}

.sound-fab {
  width: 44px;
  height: 44px;
}

.modal-overlay {
  justify-content: center;
  background: rgba(3, 13, 24, 0.58);
  backdrop-filter: blur(7px);
}

.modal-card {
  width: min(480px, 100%);
  padding: clamp(24px, 4vw, 36px);
  border: 1px solid rgba(192, 233, 255, 0.22);
  border-radius: 26px;
  background: linear-gradient(155deg, rgba(8, 27, 45, 0.94), rgba(5, 16, 29, 0.9));
  box-shadow: 0 40px 100px rgba(2, 11, 22, 0.6);
  text-align: left;
}

.modal-card.small {
  width: min(420px, 100%);
}

.modal-card h2 {
  margin: 12px 0 0;
  color: #f7fcff;
  font-size: clamp(32px, 4.6vw, 46px);
  font-weight: 900;
  letter-spacing: -0.045em;
  line-height: 1;
}

.modal-copy {
  margin: 10px 0 0;
  color: #9bc1d6;
  font-size: 12px;
  line-height: 1.65;
}

.pause-stats {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
  margin: 20px 0 0;
}

.pause-stats div,
.result-grid div {
  padding: 10px 12px;
  border-radius: 12px;
  background: rgba(132, 190, 223, 0.08);
}

.pause-stats small,
.result-grid small {
  display: block;
  color: #759fba;
  font-size: 9px;
  letter-spacing: 0.08em;
}

.pause-stats strong,
.result-grid strong {
  display: block;
  margin-top: 3px;
  color: #e9f9ff;
  font-size: 15px;
  font-variant-numeric: tabular-nums;
}

.modal-actions {
  display: flex;
  gap: 8px;
  margin-top: 9px;
}

.ghost-btn {
  flex: 1;
  min-height: 42px;
  border: 1px solid rgba(184, 224, 246, 0.16);
  border-radius: 12px;
  background: rgba(129, 183, 215, 0.08);
  color: #b6d6e9;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
  transition: background 160ms ease, color 160ms ease;
}

.ghost-btn:hover {
  background: rgba(129, 183, 215, 0.16);
  color: #eaf9ff;
}

.ghost-btn.danger:hover {
  background: rgba(255, 93, 117, 0.16);
  color: #ffd5dc;
}

.new-best {
  display: inline-flex;
  margin-top: 12px;
  padding: 6px 11px;
  border: 1px solid color-mix(in srgb, var(--accent) 40%, transparent);
  border-radius: 999px;
  background: color-mix(in srgb, var(--accent) 12%, transparent);
  color: var(--accent-soft);
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.1em;
}

.result-score {
  margin-top: 20px;
  padding: 16px 18px;
  border-radius: 16px;
  background:
    radial-gradient(circle at 90% 15%, color-mix(in srgb, var(--accent) 18%, transparent), transparent 60%),
    rgba(3, 16, 28, 0.55);
}

.result-score small {
  display: block;
  color: #7eaac5;
  font-size: 10px;
  letter-spacing: 0.12em;
}

.result-score strong {
  display: block;
  margin-top: 2px;
  color: #ffffff;
  font-size: clamp(44px, 6vw, 60px);
  font-weight: 900;
  line-height: 1;
  letter-spacing: -0.04em;
  font-variant-numeric: tabular-nums;
  text-shadow: 0 0 35px color-mix(in srgb, var(--accent) 28%, transparent);
}

.result-score span {
  display: block;
  margin-top: 5px;
  color: #7fa8c0;
  font-size: 10px;
}

.result-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 8px;
  margin-top: 10px;
}

.panel-enter-active,
.panel-leave-active {
  transition: opacity 260ms ease;
}

.panel-enter-from,
.panel-leave-to {
  opacity: 0;
}

.panel-enter-active .start-card,
.panel-enter-active .modal-card {
  animation: card-in 340ms cubic-bezier(0.2, 0.8, 0.2, 1);
}

@keyframes card-in {
  from {
    transform: translateY(16px) scale(0.985);
    opacity: 0;
  }
  to {
    transform: translateY(0) scale(1);
    opacity: 1;
  }
}

@media (max-width: 760px), (pointer: coarse) {
  .touch-controls {
    display: flex;
  }

  .hud-bottom {
    bottom: calc(174px + env(safe-area-inset-bottom));
    left: 14px;
    right: 14px;
    gap: 8px;
  }

  .stat-card {
    width: min(48%, 220px);
    padding: 10px 12px;
  }

  .speed-row strong {
    font-size: 30px;
  }

  .key-hint {
    display: none;
  }

  .health-hint {
    font-size: 9px;
  }

  .hud-top {
    top: 12px;
    left: 12px;
    right: 12px;
  }

  .brand-chip {
    padding: 8px 10px;
  }

  .brand-chip strong {
    font-size: 12px;
  }

  .brand-chip small {
    display: none;
  }

  .brand-snow {
    width: 30px;
    height: 30px;
    font-size: 17px;
  }

  .score-chip {
    min-width: 132px;
    padding: 7px 16px 8px;
  }

  .score-chip strong {
    font-size: 27px;
  }

  .score-chip span {
    display: none;
  }

  .icon-btn {
    width: 38px;
    height: 38px;
    font-size: 15px;
  }

  .toast {
    top: 88px;
    font-size: 12px;
    padding: 8px 14px;
  }

  .start-overlay {
    align-items: flex-end;
    justify-content: center;
    padding: 12px;
    background: linear-gradient(180deg, transparent 0%, rgba(3, 14, 26, 0.28) 34%, rgba(3, 14, 26, 0.8) 100%);
  }

  .start-card {
    max-height: calc(100vh - 76px);
    border-radius: 23px;
    padding: 22px 20px 18px;
  }

  .start-card h1 {
    font-size: clamp(44px, 13vw, 60px);
  }

  .intro {
    font-size: 12px;
    line-height: 1.65;
  }

  .controls-grid {
    grid-template-columns: repeat(2, 1fr);
  }

  .control-item.touch-note {
    grid-column: 1 / -1;
  }

  .start-foot {
    font-size: 9px;
    gap: 6px 12px;
  }

  .primary-btn {
    min-height: 51px;
  }

  .corner-fabs {
    top: 12px;
    right: 12px;
  }

  .sound-fab {
    width: 40px;
    height: 40px;
  }

  .modal-overlay {
    padding: 12px;
    align-items: flex-end;
  }

  .modal-card {
    border-radius: 23px;
    padding: 22px 20px;
    max-height: calc(100vh - 30px);
    overflow-y: auto;
  }
}

@media (max-width: 380px) {
  .joy {
    width: 116px;
    height: 116px;
  }

  .joy-core {
    inset: 22px;
  }

  .joy-knob {
    width: 52px;
    height: 52px;
    margin: -26px 0 0 -26px;
  }

  .jump-pad {
    width: 92px;
    height: 92px;
    font-size: 92px;
    padding: 0;
  }

  .joy-label {
    font-size: 8px;
  }
  .hud-bottom {
    bottom: calc(160px + env(safe-area-inset-bottom));
    left: 10px;
    right: 10px;
  }

  .stat-card {
    width: min(48%, 190px);
    padding: 9px 10px;
  }

  .speed-row strong {
    font-size: 26px;
  }
}

@media (orientation: landscape) and (max-height: 560px) {
  .hud-bottom {
    bottom: calc(128px + env(safe-area-inset-bottom));
  }

  .joy {
    width: 104px;
    height: 104px;
  }

  .joy-core {
    inset: 20px;
  }

  .joy-knob {
    width: 46px;
    height: 46px;
    margin: -23px 0 0 -23px;
  }

  .jump-pad {
    width: 84px;
    height: 84px;
    font-size: 84px;
    margin-bottom: 0;
  }

  .joy-label {
    display: none;
  }
}

/* 强制横屏时也用小一号的控件，避免挡住雪道 */
.ski-game.rotate-cw .hud-bottom {
  bottom: calc(128px + env(safe-area-inset-bottom));
}

.ski-game.rotate-cw .joy {
  width: 104px;
  height: 104px;
}

.ski-game.rotate-cw .joy-knob {
  width: 46px;
  height: 46px;
  margin: -23px 0 0 -23px;
}

.ski-game.rotate-cw .jump-pad {
  width: 84px;
  height: 84px;
  font-size: 84px;
}

.ski-game.rotate-cw .joy-label {
  display: none;
}

@media (max-height: 560px) and (min-width: 761px) {
  .start-card {
    transform: scale(0.9);
    transform-origin: left center;
  }
}
</style>
