import * as THREE from 'three'
import {
  ATTACK_CONFIG,
  BOMB_CONFIG,
  GAME,
  HAZARD_CONFIG,
  JACKETS,
  OBSTACLE_CONFIG,
  RIVAL_CONFIG,
  type AttackKind,
  type HudSnapshot,
  type JacketOption,
  type RunResult,
} from './data'
import { courseHalfWidthAt, heightAt, slopeAngleAt, slopeAt } from './terrain'
import { Skier, type SkierPose } from './skier'
import {
  buildChunk,
  disposeChunk,
  WorldAssets,
  type Branch,
  type Chunk,
  type Hazard,
  type Obstacle,
  type Pickup,
  type Spectator,
} from './world'
import { Rival } from './rival'
import { Truck } from './truck'
import { Snowfall, SnowSpray, Blast, Bomb, Impact } from './effects'
import { skiAudio } from './audio'

export type SkiPhase = 'ready' | 'running' | 'paused' | 'over'
export type ToastTone = 'good' | 'bad' | 'info'
export interface ToastMessage {
  text: string
  tone: ToastTone
}

export interface SkiRunOptions {
  scene: THREE.Scene
  camera: THREE.PerspectiveCamera
  jacket: JacketOption
  onHud: (hud: HudSnapshot) => void
  onToast: (toast: ToastMessage) => void
  onGameOver: (result: RunResult) => void
}

type Action = 'left' | 'right' | 'up' | 'down'

const KEY_ACTIONS: Record<string, Action> = {
  ArrowLeft: 'left',
  ArrowRight: 'right',
  ArrowUp: 'up',
  ArrowDown: 'down',
}

const SKY_VERTEX = `
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

const SKY_FRAGMENT = `
  uniform vec3 uTop;
  uniform vec3 uHorizon;
  uniform vec3 uSunColor;
  uniform vec3 uSunDir;
  varying vec3 vDir;

  void main() {
    float h = clamp(vDir.y * 0.5 + 0.5, 0.0, 1.0);
    vec3 color = mix(uHorizon, uTop, smoothstep(0.48, 0.94, h));
    float sun = pow(max(dot(normalize(vDir), normalize(uSunDir)), 0.0), 180.0);
    float glow = pow(max(dot(normalize(vDir), normalize(uSunDir)), 0.0), 8.0) * 0.16;
    color += uSunColor * (sun * 0.9 + glow);
    gl_FragColor = vec4(color, 1.0);
  }
`

export class SkiRun {
  private readonly scene: THREE.Scene
  private readonly camera: THREE.PerspectiveCamera
  private readonly options: SkiRunOptions
  private readonly assets: WorldAssets
  private readonly skier: Skier
  private readonly snowfall: Snowfall
  private readonly spray: SnowSpray
  private readonly chunks: Chunk[] = []
  private readonly branches: Branch[] = []
  private flagSkip = 0
  private readonly rivals: Rival[] = []
  private rivalTimer = 6
  private truck: Truck | null = null
  private truckTimer = 22

  private readonly sun: THREE.DirectionalLight
  private readonly hemiLight: THREE.HemisphereLight
  private readonly fillLight: THREE.DirectionalLight
  private readonly sunTarget = new THREE.Object3D()
  private readonly backdrop = new THREE.Group()
  private readonly mountainMaterial: THREE.MeshStandardMaterial
  private readonly sky: THREE.Mesh
  private readonly skyMaterial: THREE.ShaderMaterial
  private readonly skyGeometry: THREE.SphereGeometry
  private readonly lookTarget = new THREE.Vector3()
  private readonly desiredCamera = new THREE.Vector3()
  private readonly desiredLook = new THREE.Vector3()

  private phase: SkiPhase = 'ready'
  private x = 0
  private z = 0
  private y = 0
  private speed = 0
  private lateral = 0
  private distance = 0
  private score = 0
  private health = GAME.maxHealth
  private hits = 0
  private maxSpeed = 0
  private invulnerable = 0
  private jumpHeight = 0
  private jumpVelocity = 0
  private airborne = false
  private jumpRequested = false
  private jumpedOnce = false
  private shake = 0
  private damageFlash = 0
  private time = 0
  private nextMilestone = 250
  private hudTimer = 0
  private sprayTimer = 0
  private cheerCooldown = 0
  private lowHealthWarned = false
  private nextStartZ = 20
  private chunkIndex = 0
  private disposed = false

  private readonly keyboard: Record<Action, boolean> = { left: false, right: false, up: false, down: false }
  private readonly touch: Record<Action, boolean> = { left: false, right: false, up: false, down: false }
  /** 摇杆给出的模拟量转向（-1 ~ 1），带阻尼后才会作用到滑雪人身上 */
  private steerAxis = 0

  /** 摇杆画圈给出的旋转输入（rad/s，顺时针为正） */
  private spinInput = 0
  private spinInputTimer = 0
  private spinVelocity = 0
  private spinAngle = 0

  /** 正在播放的动作，以及它的剩余时间 / 总时长 */
  private actionKind: 'punch' | 'kick' | 'bomb' | null = null
  private actionTimer = 0
  private actionDuration = 0
  /** 动作朝向：-1 左侧，1 右侧 */
  private actionSide = 1
  private readonly actionCooldown: Record<'punch' | 'kick' | 'bomb', number> = { punch: 0, kick: 0, bomb: 0 }
  private readonly bombs: Bomb[] = []
  private readonly blasts: Blast[] = []
  private readonly impacts: Impact[] = []
  private bombTipShown = false
  /** 对手已经出招、还没打到你身上的那一下 */
  private pendingRivalStrike: { rival: Rival; kind: AttackKind; timer: number } | null = null
  /** 玩家挥杆/踢腿前摇结束后的那一下判定 */
  private pendingPlayerStrike: { target: Rival; kind: AttackKind; timer: number } | null = null

  constructor(options: SkiRunOptions) {
    this.options = options
    this.scene = options.scene
    this.camera = options.camera
    this.assets = new WorldAssets()
    this.skier = new Skier(options.jacket)
    this.scene.add(this.skier.group)
    this.buildMarker()

    this.mountainMaterial = new THREE.MeshStandardMaterial({ color: '#7892a8', roughness: 1 })
    this.skyGeometry = new THREE.SphereGeometry(420, 24, 16)
    this.skyMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uTop: { value: new THREE.Color('#3d77b7') },
        uHorizon: { value: new THREE.Color('#e8f3fc') },
        uSunColor: { value: new THREE.Color('#ffeccb') },
        uSunDir: { value: new THREE.Vector3(-0.42, 0.45, -0.8) },
      },
      vertexShader: SKY_VERTEX,
      fragmentShader: SKY_FRAGMENT,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
    })
    this.sky = new THREE.Mesh(this.skyGeometry, this.skyMaterial)
    this.sky.frustumCulled = false
    this.sky.renderOrder = -100
    this.scene.add(this.sky)

    this.scene.background = new THREE.Color('#dfeaf7')
    this.scene.fog = new THREE.Fog('#dfeaf7', 45, 430)

    this.hemiLight = new THREE.HemisphereLight('#e8f7ff', '#91a7bb', 1.2)
    this.fillLight = new THREE.DirectionalLight('#c7e3ff', 0.45)
    this.sun = new THREE.DirectionalLight('#fff3dc', 2.3)
    this.buildLights()
    this.buildBackdrop()
    this.snowfall = new Snowfall(this.scene)
    this.spray = new SnowSpray(this.scene)

    this.camera.fov = 55
    this.camera.near = 0.1
    this.camera.far = 600
    this.camera.updateProjectionMatrix()

    this.resetRun()
    this.bindInput()
    this.emitHud()
  }

  private buildLights(): void {
    this.scene.add(this.hemiLight)

    this.sun.castShadow = true
    this.sun.shadow.mapSize.set(1024, 1024)
    const cam = this.sun.shadow.camera
    cam.left = -34
    cam.right = 34
    cam.top = 34
    cam.bottom = -34
    cam.near = 1
    cam.far = 180
    this.sun.shadow.bias = -0.0004
    this.sun.shadow.normalBias = 0.02
    this.scene.add(this.sun)
    this.scene.add(this.sunTarget)
    this.sun.target = this.sunTarget

    this.fillLight.position.set(25, 18, -30)
    this.scene.add(this.fillLight)
  }

  private buildBackdrop(): void {
    this.backdrop.name = 'mountain-backdrop'
    const rows = [
      { count: 8, z: -260, minX: -240, maxX: 240, minH: 55, maxH: 110, tint: 0.35 },
      { count: 9, z: -340, minX: -320, maxX: 320, minH: 75, maxH: 155, tint: 0.12 },
    ]
    rows.forEach(row => {
      for (let i = 0; i < row.count; i++) {
        const height = row.minH + Math.random() * (row.maxH - row.minH)
        const radius = height * (0.55 + Math.random() * 0.28)
        const x = row.minX + (i / (row.count - 1)) * (row.maxX - row.minX) + (Math.random() - 0.5) * 22
        const z = row.z + (Math.random() - 0.5) * 45
        const mountain = new THREE.Mesh(this.assets.cone, this.mountainMaterial.clone())
        const material = mountain.material as THREE.MeshStandardMaterial
        material.color.lerp(new THREE.Color('#c8dced'), row.tint)
        mountain.scale.set(radius, height, radius)
        mountain.position.set(x, height / 2 - 24, z)
        mountain.rotation.y = Math.random() * Math.PI
        this.backdrop.add(mountain)

        const cap = new THREE.Mesh(this.assets.cone, this.assets.snowMaterial)
        cap.scale.set(radius * 0.5, height * 0.28, radius * 0.5)
        cap.position.set(x, height - 24 - height * 0.14, z)
        cap.rotation.y = mountain.rotation.y
        this.backdrop.add(cap)
      }
    })
    this.scene.add(this.backdrop)
  }

  private bindInput(): void {
    window.addEventListener('keydown', this.onKeyDown, { passive: false })
    window.addEventListener('keyup', this.onKeyUp)
    window.addEventListener('blur', this.onBlur)
  }

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    const target = event.target
    if (event.code === 'Space') {
      if (this.phase === 'running') {
        event.preventDefault()
        if (!event.repeat) this.jump()
      }
      return
    }
    const action = KEY_ACTIONS[event.code]
    if (!action) return
    if (target instanceof HTMLElement && target.closest('input, textarea, select')) return
    event.preventDefault()
    if (this.phase === 'running') this.keyboard[action] = true
  }

  private readonly onKeyUp = (event: KeyboardEvent): void => {
    const action = KEY_ACTIONS[event.code]
    if (action) this.keyboard[action] = false
  }

  private readonly onBlur = (): void => {
    this.clearInputs()
  }

  private isDown(action: Action): boolean {
    return this.keyboard[action] || this.touch[action]
  }

  private clearInputs(): void {
    ;(['left', 'right', 'up', 'down'] as Action[]).forEach(action => {
      this.keyboard[action] = false
      this.touch[action] = false
    })
    this.steerAxis = 0
    this.spinInput = 0
    this.spinInputTimer = 0
    this.jumpRequested = false
  }

  start(): void {
    if (this.phase === 'over') this.resetRun()
    if (this.phase !== 'ready') return
    this.phase = 'running'
    this.speed = 7
    this.clearInputs()
    skiAudio.startAmbience()
    skiAudio.countdown()
    this.pushToast('出发！用左右键控向，前后键调速', 'good')
    this.emitHud()
  }

  restart(): void {
    skiAudio.stopAmbience()
    this.resetRun()
    this.phase = 'running'
    this.speed = 7
    this.clearInputs()
    skiAudio.startAmbience()
    skiAudio.countdown()
    this.pushToast('重新出发！', 'good')
    this.emitHud()
  }

  resetToReady(): void {
    skiAudio.stopAmbience()
    this.resetRun()
    this.phase = 'ready'
    this.emitHud()
  }

  pause(): void {
    if (this.phase !== 'running') return
    this.phase = 'paused'
    this.clearInputs()
    skiAudio.setPaused(true)
    this.emitHud()
  }

  resume(): void {
    if (this.phase !== 'paused') return
    this.phase = 'running'
    skiAudio.setPaused(false)
    this.emitHud()
  }

  togglePause(): boolean {
    if (this.phase === 'running') {
      this.pause()
      return true
    }
    if (this.phase === 'paused') {
      this.resume()
      return false
    }
    return false
  }

  quit(): void {
    this.finish('quit')
  }

  setJacket(jacket: JacketOption): void {
    this.skier.setJacket(jacket)
  }

  setTouch(action: Action, pressed: boolean): void {
    this.touch[action] = pressed
  }

  /** 移动端摇杆：-1 向左满，1 向右满 */
  setSteer(value: number): void {
    this.steerAxis = THREE.MathUtils.clamp(Number.isFinite(value) ? value : 0, -1, 1)
  }

  /** 移动端摇杆画圈：正值顺时针、负值逆时针，单位 rad/s */
  setSpin(value: number): void {
    const rate = Number.isFinite(value) ? value : 0
    this.spinInput = THREE.MathUtils.clamp(rate, -18, 18)
    this.spinInputTimer = 0.14
  }

  /** 空格或移动端“跳”按钮 */
  jump(): void {
    if (this.phase === 'running' && !this.airborne) this.jumpRequested = true
  }

  /** 挥雪杖 / 飞踢：只对身边最近的对手生效 */
  attack(kind: AttackKind): void {
    if (this.phase !== 'running') return
    if (this.actionCooldown[kind] > 0) return
    const config = ATTACK_CONFIG[kind]
    this.actionCooldown[kind] = config.cooldown
    const target = this.nearestRival(config.range, config.reach)
    // 敌人在左侧就用左手左脚，在右侧就用右手右脚
    this.actionSide = target ? (target.x >= this.x ? 1 : -1) : this.lateral >= 0 ? 1 : -1
    this.playAction(kind)
    if (kind === 'punch') skiAudio.swing(false)
    else skiAudio.kick(false)
    if (!target) return
    // 等动作打到一半再结算命中，特效和音效才对得上挥杆/踢腿
    this.pendingPlayerStrike = { target, kind, timer: 0.18 }
  }

  /** 丢下爆弹：留在身后，等别人靠近再炸 */
  dropBomb(): void {
    if (this.phase !== 'running') return
    if (this.actionCooldown.bomb > 0) return
    this.actionCooldown.bomb = BOMB_CONFIG.cooldown
    this.playAction('bomb')
    const bomb = new Bomb(this.x, this.y + 0.4, this.z + 1.4, BOMB_CONFIG.life)
    this.scene.add(bomb.group)
    this.bombs.push(bomb)
    skiAudio.bombDrop()
    if (!this.bombTipShown) {
      this.bombTipShown = true
      this.pushToast('爆弹丢在身后，谁靠近谁倒霉', 'info')
    }
  }

  getPhase(): SkiPhase {
    return this.phase
  }

  private resetRun(): void {
    this.phase = 'ready'
    for (const chunk of this.chunks) disposeChunk(chunk)
    this.chunks.length = 0
    this.branches.length = 0
    this.flagSkip = 0
    this.clearRivals()
    this.clearTruck()
    this.truckTimer = 22
    this.rivalTimer = 6
    this.nextStartZ = 20
    this.chunkIndex = 0
    this.x = 0
    this.z = 0
    this.y = heightAt(0)
    this.speed = 0
    this.lateral = 0
    this.distance = 0
    this.score = 0
    this.health = GAME.maxHealth
    this.hits = 0
    this.maxSpeed = 0
    this.invulnerable = 0
    this.jumpHeight = 0
    this.jumpVelocity = 0
    this.airborne = false
    this.jumpRequested = false
    this.jumpedOnce = false
    this.shake = 0
    this.damageFlash = 0
    this.time = 0
    this.nextMilestone = 250
    this.hudTimer = 0
    this.sprayTimer = 0
    this.cheerCooldown = 0
    this.lowHealthWarned = false
    this.spinInput = 0
    this.spinInputTimer = 0
    this.spinVelocity = 0
    this.spinAngle = 0
    this.actionKind = null
    this.actionTimer = 0
    this.actionDuration = 0
    this.actionSide = 1
    this.actionCooldown.punch = 0
    this.actionCooldown.kick = 0
    this.actionCooldown.bomb = 0
    this.bombTipShown = false
    this.pendingRivalStrike = null
    this.pendingPlayerStrike = null
    this.clearEffects()
    this.spray.clear()
    this.skier.resetPose()
    this.skier.group.position.set(0, this.y, 0)
    this.fillChunks()
    this.snapCamera()
    this.emitHud()
  }

  private readonly marker = new THREE.Group()
  private readonly markerMaterials: THREE.MeshBasicMaterial[] = []

  /** 玩家头顶的小箭头，用来和同色对手区分 */
  private buildMarker(): void {
    const gold = new THREE.MeshBasicMaterial({
      color: '#ffb02e',
      transparent: true,
      opacity: 0.96,
      depthWrite: false,
    })
    const pale = new THREE.MeshBasicMaterial({
      color: '#fff2c6',
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
    })
    this.markerMaterials.push(gold, pale)

    // 箭头 ↧：一根短柄 + 一个向下的三角头
    const shaft = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.3, 0.13), pale)
    shaft.position.y = 0.2
    this.marker.add(shaft)

    const head = new THREE.Mesh(new THREE.ConeGeometry(0.21, 0.34, 16), gold)
    head.position.y = -0.12
    head.rotation.x = Math.PI
    this.marker.add(head)

    this.marker.position.y = 2.3
    this.marker.renderOrder = 4
    this.skier.group.add(this.marker)
  }

  private animateMarker(dt: number): void {
    this.marker.position.y = 2.3 + Math.sin(this.time * 3.4) * 0.09
    this.marker.rotation.y += dt * 0.8
    const pulse = 0.75 + Math.sin(this.time * 3.4) * 0.2
    const gold = this.markerMaterials[0]
    const pale = this.markerMaterials[1]
    if (gold) gold.opacity = pulse
    if (pale) pale.opacity = pulse * 0.9
  }

  private fillChunks(): void {
    while (this.nextStartZ > this.z - GAME.viewAhead) {
      const startZ = this.nextStartZ
      const difficulty = Math.min(1, Math.max(0, -startZ / 1500))
      const chunk = buildChunk(this.assets, startZ, difficulty, this.chunkIndex, this.flagSkip > 0)
      this.scene.add(chunk.group)
      this.chunks.push(chunk)
      if (chunk.branch) {
        this.branches.push(chunk.branch)
        // 岔路本身加上后面两段都不插旗，保持雪道干净
        this.flagSkip = 3
      } else if (this.flagSkip > 0) {
        this.flagSkip -= 1
      }
      this.chunkIndex += 1
      this.nextStartZ -= GAME.chunkLength
    }
  }

  /**
   * 当前 z 处可滑行的 x 区间。
   * 普通雪道是一条区间；Y 形岔路时是左右两条区间，中间是隆起的分隔带。
   */
  private corridorSpans(): Array<{ min: number; max: number }> {
    const width = courseHalfWidthAt(this.z)
    for (const branch of this.branches) {
      if (this.z > branch.startZ || this.z < branch.endZ) continue
      const span = Math.max(0.001, branch.startZ - branch.endZ)
      const t = THREE.MathUtils.clamp((branch.startZ - this.z) / span, 0, 1)
      const divide = Math.min(branch.divide, width * 0.42) * Math.sin(Math.PI * t)
      if (divide <= 0.25) break
      return [
        { min: -width, max: -divide },
        { min: divide, max: width },
      ]
    }
    return [{ min: -width, max: width }]
  }

  /** 被雪堤/分叉分隔带挡住时，平滑地推回最近的一条雪道 */
  private applyCourseBounds(dt: number): void {
    const spans = this.corridorSpans()
    for (const span of spans) {
      if (this.x >= span.min - 0.02 && this.x <= span.max + 0.02) return
    }
    let target = this.x
    let nearest = Number.POSITIVE_INFINITY
    for (const span of spans) {
      const candidate = this.x < span.min ? span.min : span.max
      const distance = Math.abs(this.x - candidate)
      if (distance < nearest) {
        nearest = distance
        target = candidate
      }
    }
    this.x += (target - this.x) * Math.min(1, dt * 12)
    this.lateral *= -0.2
    this.speed *= 0.99
  }

  /** 快进入岔道时给一句提示 */
  private announceBranches(): void {
    for (const branch of this.branches) {
      if (branch.seen) continue
      if (this.z > branch.startZ + 2 || this.z < branch.startZ - 26) continue
      branch.seen = true
      this.pushToast('前方岔路 · 左右任选一条', 'info')
    }
  }

  private updateChunks(): void {
    this.fillChunks()
    for (let i = this.chunks.length - 1; i >= 0; i--) {
      const chunk = this.chunks[i]
      if (!chunk) continue
      if (chunk.startZ - GAME.chunkLength > this.z + 36) {
        if (chunk.branch) {
          const index = this.branches.indexOf(chunk.branch)
          if (index >= 0) this.branches.splice(index, 1)
        }
        disposeChunk(chunk)
        this.chunks.splice(i, 1)
      }
    }
  }

  update(dtRaw: number): void {
    if (this.disposed) return
    const dt = Math.min(Math.max(dtRaw, 0.001), 0.05)
    this.time += dt

    if (this.phase === 'running') {
      this.step(dt)
    } else {
      this.skier.update(dt, this.currentPose())
      this.skier.group.position.set(this.x, this.y + this.jumpHeight, this.z)
    }

    this.updateChunks()
    this.updateRivals(dt)
    this.updateTruck(dt)
    this.updateBombs(dt)
    this.updateImpacts(dt)
    this.updatePickups(dt)
    this.updateHazards(dt)
    this.animateMarker(dt)
    this.updateCamera(dt, false)
    this.updateWorldVisuals(dt)
    this.updateSpectators(dt)
    this.updateHud(dt)

    this.shake = Math.max(0, this.shake - dt * 2.6)
    this.damageFlash = Math.max(0, this.damageFlash - dt * 2.4)
  }

  private step(dt: number): void {
    this.tickActionTimers(dt)
    this.updateSpin(dt)
    const slope = slopeAt(this.z)
    const keyboardSteer = Number(this.isDown('right')) - Number(this.isDown('left'))
    const steeringInput = keyboardSteer !== 0 ? keyboardSteer : this.steerAxis
    const braking = this.isDown('down')

    if (this.jumpRequested) {
      this.jumpRequested = false
      if (!this.airborne) this.takeOff()
    }

    if (this.airborne) {
      this.speed = Math.max(GAME.minSpeed, this.speed - 0.45 * dt)
    } else {
      let acceleration = 4.6 * slope - 0.0034 * this.speed * this.speed
      if (this.isDown('up')) acceleration += 7.4
      if (braking) acceleration -= 12.5
      this.speed = THREE.MathUtils.clamp(this.speed + acceleration * dt, GAME.minSpeed, GAME.maxSpeed)
    }
    this.maxSpeed = Math.max(this.maxSpeed, this.speed)

    const steerFactor = this.airborne ? 0.62 : 1
    const targetLateral = THREE.MathUtils.clamp(steeringInput, -1, 1) * GAME.steerSpeed * steerFactor
    // 摇杆要“肉”一点：响应更慢 + 释放时缓缓回正；键盘保持跟手
    const response = this.airborne ? 2.6 : keyboardSteer !== 0 ? 5.6 : 4.2
    this.lateral += (targetLateral - this.lateral) * Math.min(1, dt * response)
    this.x += this.lateral * dt
    this.applyCourseBounds(dt)

    const angle = slopeAngleAt(this.z)
    this.z -= this.speed * Math.cos(angle) * dt
    this.distance += this.speed * dt
    this.y = heightAt(this.z)
    this.score += this.speed * dt * 1.55

    if (this.airborne) {
      this.jumpVelocity -= GAME.jumpGravity * dt
      this.jumpHeight += this.jumpVelocity * dt
      if (this.jumpHeight <= 0) this.land()
    }

    this.skier.group.position.set(this.x, this.y + this.jumpHeight, this.z)
    this.skier.update(dt, this.currentPose())

    this.checkCollisions(dt)
    this.checkRivalAttacks()
    this.updatePlayerStrikes(dt)
    this.updateRivalStrikes(dt)
    this.separateRivals(dt)
    this.checkTruckCollision()
    if (this.phase !== 'running') return

    this.spawnSpray(dt)
    this.updateMilestones()
    this.announceBranches()
    skiAudio.updateAmbience(this.speed, Math.min(1, Math.abs(this.lateral) / GAME.steerSpeed * 0.65 + (braking ? 0.45 : 0)))
  }

  private currentPose(): SkierPose {
    const slope = slopeAngleAt(this.z)
    return {
      pitch: -slope * 0.92 - 0.1,
      yaw: -this.lateral * 0.055,
      lean: -this.lateral * 0.035 + (this.isDown('down') ? 0.04 : 0),
      speed: this.speed,
      steering: this.lateral / GAME.steerSpeed,
      braking: this.isDown('down'),
      time: this.time,
      airborne: this.airborne,
      airHeight: this.jumpHeight,
      spin: this.spinAngle,
      action: this.actionKind,
      actionProgress:
        this.actionKind && this.actionDuration > 0 ? 1 - this.actionTimer / this.actionDuration : 0,
      actionSide: this.actionSide,
    }
  }

  private takeOff(): void {
    this.airborne = true
    this.jumpVelocity = GAME.jumpVelocity
    this.jumpHeight = 0.02
    this.shake = Math.max(this.shake, 0.18)
    this.spray.burst(this.x, this.y, this.z, 14)
    skiAudio.jump()
    this.emitHud()
    if (!this.jumpedOnce) {
      this.jumpedOnce = true
      this.pushToast('腾空！空格 / 屏幕「跳」键起跳', 'info')
    }
  }

  private land(): void {
    this.airborne = false
    this.jumpHeight = 0
    this.jumpVelocity = 0
    this.speed = Math.max(GAME.minSpeed, this.speed * 0.98)
    this.shake = Math.max(this.shake, 0.3)
    this.spray.burst(this.x, this.y, this.z, 18)
    skiAudio.land()
    this.emitHud()
  }

  private spawnSpray(dt: number): void {
    this.sprayTimer -= dt
    if (this.airborne || this.speed < 7 || this.sprayTimer > 0) return
    const carving = this.isDown('down') || Math.abs(this.lateral) > 2.2
    this.spray.spray(this.x, this.y, this.z, carving ? 3 : 2, this.lateral, this.speed)
    this.sprayTimer = carving ? 0.045 : 0.075
  }

  private checkCollisions(dt: number): void {
    if (this.invulnerable > 0) {
      this.invulnerable -= dt
      return
    }
    for (const chunk of this.chunks) {
      if (chunk.startZ < this.z - 18 || chunk.startZ - GAME.chunkLength > this.z + 8) continue
      for (const obstacle of chunk.obstacles) {
        if (!obstacle.active) continue
        if (this.jumpHeight > OBSTACLE_CONFIG[obstacle.kind].clearance) continue
        const dx = this.x - obstacle.x
        const dz = this.z - obstacle.z
        const reach = 0.48 + obstacle.radius
        if (dx * dx + dz * dz > reach * reach) continue
        this.hitObstacle(obstacle)
        return
      }
    }
  }

  private hitObstacle(obstacle: Obstacle): void {
    const config = OBSTACLE_CONFIG[obstacle.kind]
    this.health = Math.max(0, this.health - config.health)
    this.score = Math.max(0, this.score - config.penalty)
    this.hits += 1
    this.speed *= obstacle.kind === 'snowball' ? 0.72 : 0.55
    const direction = this.x >= obstacle.x ? 1 : -1
    const width = courseHalfWidthAt(this.z)
    this.x = THREE.MathUtils.clamp(this.x + direction * 0.8, -width, width)
    this.lateral = direction * 2.6
    this.invulnerable = 1.1
    this.shake = 1
    this.damageFlash = 1
    this.spray.burst(obstacle.x, this.y + 0.25, obstacle.z, obstacle.kind === 'snowball' ? 22 : 16)
    if (obstacle.kind === 'snowball') {
      obstacle.active = false
      obstacle.group.visible = false
    }
    skiAudio.hit(obstacle.kind)
    if (this.hasCrowdNearby()) skiAudio.gasp()
    this.pushToast(`−${config.penalty} 分 · 撞到${config.label}，体力 −${config.health}`, 'bad')
    this.emitHud()

    if (this.health < 32 && !this.lowHealthWarned) {
      this.lowHealthWarned = true
      this.pushToast('体力不足，稳住方向！', 'bad')
    }
    if (this.health <= 0) this.finish('health')
  }

  /* ---------- 对手滑雪者 ---------- */

  private updateRivals(dt: number): void {
    for (let i = this.rivals.length - 1; i >= 0; i--) {
      const rival = this.rivals[i]
      if (!rival) continue
      if (this.phase === 'running') rival.update(dt, this.x, this.z, this.speed)
      if (rival.gone || rival.z > this.z + 46 || rival.z < this.z - 260) {
        rival.dispose()
        this.rivals.splice(i, 1)
      }
    }

    if (this.phase !== 'running') return
    this.rivalTimer -= dt
    const maxRivals = this.distance > 700 ? 3 : this.distance > 260 ? 2 : 1
    if (this.rivalTimer <= 0 && this.distance > 85 && this.rivals.length < maxRivals) {
      this.spawnRival()
      this.rivalTimer = 5 + Math.random() * 4.5
    }
  }

  private spawnRival(): void {
    const used = new Set(this.rivals.map(rival => rival.jacket.id))
    const pool = JACKETS.filter(item => item.id !== this.options.jacket.id && !used.has(item.id))
    const jacket = pool[Math.floor(Math.random() * pool.length)] ?? JACKETS[0]!
    const side = Math.random() > 0.5 ? 1 : -1
    const width = courseHalfWidthAt(this.z)
    const x = side * (width * 0.25 + Math.random() * width * 0.5)
    const z = this.z - (26 + Math.random() * 16)
    const rival = new Rival(jacket, x, z, 9 + Math.random() * 4)
    this.scene.add(rival.group)
    this.rivals.push(rival)
    this.pushToast('小心，前面有别的滑雪者！', 'info')
  }

  /** 玩家的攻击前摇结束，目标还在范围内才算命中 */
  private updatePlayerStrikes(dt: number): void {
    const pending = this.pendingPlayerStrike
    if (!pending) return
    pending.timer -= dt
    if (pending.timer > 0) return
    this.pendingPlayerStrike = null
    if (this.phase !== 'running') return
    const target = pending.target
    if (!this.rivals.includes(target) || target.knockedOut || target.hurtCooldown > 0) return
    const config = ATTACK_CONFIG[pending.kind]
    const dx = target.x - this.x
    const dz = target.z - this.z
    if (Math.abs(dx) > config.reach || Math.abs(dz) > config.range) return
    skiAudio.impact(pending.kind)
    this.strikeRival(target, pending.kind)
  }

  /**
   * 对手靠近后会主动出手打你。
   * 这里不再靠身体接触扣体力：只有真被对方的挥杆或飞踢打中才掉血。
   */
  private checkRivalAttacks(): void {
    if (this.invulnerable > 0 || this.jumpHeight > 1.35) return
    for (const rival of this.rivals) {
      if (rival.knockedOut || rival.stun > 0 || rival.attackCooldown > 0) continue
      const dx = this.x - rival.x
      const dz = this.z - rival.z
      if (dx * dx + dz * dz > RIVAL_CONFIG.attackRange * RIVAL_CONFIG.attackRange) continue
      const kind: AttackKind = Math.random() < 0.55 ? 'punch' : 'kick'
      // 玩家在对手哪一侧，对手就用哪只手 / 哪条腿
      rival.attack(kind, dx >= 0 ? 1 : -1)
      this.pendingRivalStrike = { rival, kind, timer: 0.16 }
      return
    }
  }

  /** 对手出招的前摇结束，真的打到你身上才扣体力 */
  private updateRivalStrikes(dt: number): void {
    const pending = this.pendingRivalStrike
    if (!pending) return
    pending.timer -= dt
    if (pending.timer > 0) return
    this.pendingRivalStrike = null
    if (this.phase !== 'running' || this.invulnerable > 0) return
    // 对手可能已经离场
    if (!this.rivals.includes(pending.rival)) return
    // 被你抢攻打断，或者已经跑出了攻击范围，这一下就落空
    if (pending.rival.knockedOut || pending.rival.stun > 0) return
    const dx = this.x - pending.rival.x
    const dz = this.z - pending.rival.z
    if (dx * dx + dz * dz > 4.2 * 4.2) return
    this.takeRivalHit(pending.rival, pending.kind)
  }

  /** 贴在一起时轻轻挤开，不扣体力 */
  private separateRivals(dt: number): void {
    for (const rival of this.rivals) {
      if (rival.knockedOut) continue
      const dx = this.x - rival.x
      const dz = this.z - rival.z
      const distance = Math.hypot(dx, dz)
      if (distance > 1.8 || distance < 0.0001) continue
      const push = (1.8 - distance) * Math.min(1, dt * 8)
      const direction = dx >= 0 ? 1 : -1
      const width = courseHalfWidthAt(this.z)
      this.x = THREE.MathUtils.clamp(this.x + direction * push * 0.5, -width, width)
      rival.x = THREE.MathUtils.clamp(rival.x - direction * push * 0.5, -11, 11)
    }
  }

  /** 被对手打中：掉体力、扣分、闪红 */
  private takeRivalHit(rival: Rival, kind: AttackKind): void {
    const damage = kind === 'punch' ? 12 : 16
    const penalty = kind === 'punch' ? 80 : 120
    this.health = Math.max(0, this.health - damage)
    this.score = Math.max(0, this.score - penalty)
    this.hits += 1
    this.speed *= 0.9
    const direction = this.x >= rival.x ? 1 : -1
    const width = courseHalfWidthAt(this.z)
    this.x = THREE.MathUtils.clamp(this.x + direction * 0.55, -width, width)
    this.lateral = direction * 2.2
    this.invulnerable = 1.2
    this.shake = Math.max(this.shake, 0.8)
    this.damageFlash = 1
    this.spawnImpact(this.x, this.y + 1.1, this.z, '#ff9d9d', 1.05)
    this.spray.burst(this.x, this.y + 0.5, this.z, 12)
    if (kind === 'punch') skiAudio.swing(true)
    else skiAudio.kick(true)
    if (this.hasCrowdNearby()) skiAudio.gasp()
    this.pushToast(
      `−${penalty} 分 · 被对手${kind === 'punch' ? '一杆扫中' : '一脚踢中'}，体力 −${damage}`,
      'bad',
    )
    this.emitHud()

    if (this.health < 32 && !this.lowHealthWarned) {
      this.lowHealthWarned = true
      this.pushToast('体力不足，稳住方向！', 'bad')
    }
    if (this.health <= 0) this.finish('health')
  }

  /* ---------- 动手：挥杆 / 踹人 / 爆弹 ---------- */

  private tickActionTimers(dt: number): void {
    this.actionCooldown.punch = Math.max(0, this.actionCooldown.punch - dt)
    this.actionCooldown.kick = Math.max(0, this.actionCooldown.kick - dt)
    this.actionCooldown.bomb = Math.max(0, this.actionCooldown.bomb - dt)
    if (this.actionTimer <= 0) return
    this.actionTimer = Math.max(0, this.actionTimer - dt)
    if (this.actionTimer === 0) this.actionKind = null
  }

  /** 摇杆画圈的旋转：输入消失后自然减速，最后转回正前方 */
  private updateSpin(dt: number): void {
    if (this.spinInputTimer > 0) this.spinInputTimer = Math.max(0, this.spinInputTimer - dt)
    const target = this.spinInputTimer > 0 ? this.spinInput : 0
    this.spinVelocity += (target - this.spinVelocity) * Math.min(1, dt * 9)
    this.spinAngle += this.spinVelocity * dt

    if (Math.abs(this.spinVelocity) < 0.25 && Math.abs(target) < 0.25) {
      const nearest = Math.round(this.spinAngle / (Math.PI * 2)) * (Math.PI * 2)
      this.spinAngle += (nearest - this.spinAngle) * Math.min(1, dt * 6)
      if (Math.abs(nearest - this.spinAngle) < 0.008) {
        this.spinAngle = nearest
        this.spinVelocity = 0
      }
    }
  }

  private playAction(kind: 'punch' | 'kick' | 'bomb'): void {
    this.actionKind = kind
    this.actionDuration = kind === 'bomb' ? BOMB_CONFIG.duration : ATTACK_CONFIG[kind].duration
    this.actionTimer = this.actionDuration
  }

  /** 身边最近的可攻击对手 */
  private nearestRival(range: number, reach: number): Rival | null {
    let best: Rival | null = null
    let bestDistance = Number.POSITIVE_INFINITY
    for (const rival of this.rivals) {
      if (rival.knockedOut || rival.hurtCooldown > 0) continue
      const dx = rival.x - this.x
      const dz = rival.z - this.z
      if (Math.abs(dx) > reach || Math.abs(dz) > range) continue
      const distance = dx * dx + dz * dz
      if (distance < bestDistance) {
        bestDistance = distance
        best = rival
      }
    }
    return best
  }

  private strikeRival(rival: Rival, kind: AttackKind): void {
    const config = ATTACK_CONFIG[kind]
    const direction = this.x >= rival.x ? 1 : -1
    rival.knock(direction)
    rival.stun = 0.9
    rival.hurtCooldown = 0.45
    const knockedOut = rival.damage(config.damage)
    const bonus = config.bonus + (knockedOut ? RIVAL_CONFIG.koBonus : 0)
    this.score += bonus
    this.shake = Math.max(this.shake, knockedOut ? 0.75 : 0.45)
    this.spawnImpact(
      rival.x,
      heightAt(rival.z) + 1.15,
      rival.z,
      kind === 'punch' ? '#dff4ff' : '#ffd08a',
      kind === 'kick' ? 1.3 : 1,
    )
    this.spray.burst(rival.x, this.y + 0.9, rival.z, 12)
    this.pushToast(
      knockedOut
        ? `${config.label}命中，对手被撞翻了！+${bonus} 分`
        : `${config.label}命中！+${bonus} 分`,
      'good',
    )
    this.emitHud()
  }

  private updateBombs(dt: number): void {
    for (let i = this.bombs.length - 1; i >= 0; i--) {
      const bomb = this.bombs[i]
      if (!bomb) continue
      bomb.update(dt)
      const armed = bomb.elapsedTime > BOMB_CONFIG.armDelay
      const triggered =
        armed && this.hasRivalNear(bomb.x, bomb.z, BOMB_CONFIG.triggerRadius)
      if (!triggered && !bomb.expired) continue
      this.explodeBomb(bomb)
      bomb.dispose()
      this.bombs.splice(i, 1)
    }

    for (let i = this.blasts.length - 1; i >= 0; i--) {
      const blast = this.blasts[i]
      if (!blast) continue
      if (blast.update(dt)) continue
      blast.dispose()
      this.blasts.splice(i, 1)
    }
  }

  private updateImpacts(dt: number): void {
    for (let i = this.impacts.length - 1; i >= 0; i--) {
      const impact = this.impacts[i]
      if (!impact) continue
      if (impact.update(dt)) continue
      impact.dispose()
      this.impacts.splice(i, 1)
    }
  }

  private spawnImpact(x: number, y: number, z: number, color: string, scale = 1): void {
    const impact = new Impact(x, y, z, color, scale)
    this.scene.add(impact.group)
    this.impacts.push(impact)
  }

  private hasRivalNear(x: number, z: number, radius: number): boolean {
    for (const rival of this.rivals) {
      if (rival.knockedOut) continue
      const dx = rival.x - x
      const dz = rival.z - z
      if (dx * dx + dz * dz <= radius * radius) return true
    }
    return false
  }

  private explodeBomb(bomb: Bomb): void {
    const radius = BOMB_CONFIG.radius
    let hits = 0
    let knockedOut = 0
    for (const rival of this.rivals) {
      if (rival.knockedOut) continue
      const dx = rival.x - bomb.x
      const dz = rival.z - bomb.z
      if (dx * dx + dz * dz > radius * radius) continue
      rival.knock(rival.x >= bomb.x ? 1 : -1)
      rival.stun = 1.6
      rival.hurtCooldown = 1.6
      hits += 1
      if (rival.damage(BOMB_CONFIG.damage)) knockedOut += 1
    }

    const blast = new Blast(bomb.x, bomb.y, bomb.z, radius)
    this.scene.add(blast.group)
    this.blasts.push(blast)
    this.spray.burst(bomb.x, bomb.y + 0.4, bomb.z, 26)
    this.shake = Math.max(this.shake, 1)
    skiAudio.explosion()

    if (hits === 0 || this.phase !== 'running') return
    const bonus = BOMB_CONFIG.bonus * hits + RIVAL_CONFIG.koBonus * knockedOut
    this.score += bonus
    if (this.hasCrowdNearby()) skiAudio.cheer()
    this.pushToast(
      knockedOut > 0
        ? `爆弹炸翻 ${knockedOut} 名滑雪者 · +${bonus} 分`
        : `爆弹命中 ${hits} 名滑雪者 · +${bonus} 分`,
      'good',
    )
    this.emitHud()
  }

  private clearEffects(): void {
    for (const bomb of this.bombs) bomb.dispose()
    this.bombs.length = 0
    for (const blast of this.blasts) blast.dispose()
    this.blasts.length = 0
    for (const impact of this.impacts) impact.dispose()
    this.impacts.length = 0
  }

  private clearRivals(): void {
    for (const rival of this.rivals) rival.dispose()
    this.rivals.length = 0
  }

  /* ---------- 空中奖励 ---------- */

  private updatePickups(dt: number): void {
    for (const chunk of this.chunks) {
      if (chunk.pickups.length === 0) continue
      if (chunk.startZ < this.z - 26 || chunk.startZ - GAME.chunkLength > this.z + 14) continue
      for (const pickup of chunk.pickups) {
        if (pickup.taken) continue
        pickup.group.rotation.y += dt * 2.4
        pickup.group.position.y = pickup.y + Math.sin(this.time * 3.2 + pickup.phase) * 0.14
        if (this.phase !== 'running') continue
        // 飘在 2 米多高的位置，必须跳起来才吃得到
        if (this.jumpHeight < 0.7) continue
        const dx = this.x - pickup.x
        const dz = this.z - pickup.z
        if (Math.abs(dx) > 1.35 || Math.abs(dz) > 1.9) continue
        this.collectPickup(pickup)
      }
    }
  }

  private collectPickup(pickup: Pickup): void {
    pickup.taken = true
    pickup.group.visible = false
    pickup.trail.got += 1

    let label = ''
    if (pickup.kind === 'snowflake') {
      this.health = Math.min(GAME.maxHealth, this.health + 16)
      this.score += 120
      label = '雪晶 · 体力 +16'
    } else if (pickup.kind === 'bread') {
      this.health = Math.min(GAME.maxHealth, this.health + 26)
      this.score += 80
      label = '面包 · 体力 +26'
    } else if (pickup.kind === 'icecream') {
      this.health = Math.min(GAME.maxHealth, this.health + 18)
      this.score += 180
      label = '雪糕 · 体力 +18'
    } else if (pickup.kind === 'diamond') {
      this.score += 400
      label = '钻石 · +400 分'
    } else {
      this.invulnerable = Math.max(this.invulnerable, 5)
      this.score += 80
      label = '护盾 · 5 秒无敌'
    }

    this.spray.burst(pickup.x, this.y + 0.6, pickup.z, 12)
    skiAudio.pickup(pickup.kind)

    const finished = pickup.trail.got >= pickup.trail.total
    if (finished) {
      this.score += 250
      this.pushToast(`${label} · 连收 ${pickup.trail.total} 件 +250`, 'good')
    } else {
      this.pushToast(label, 'good')
    }
    this.emitHud()
  }

  /* ---------- 空中危险物 ---------- */

  private updateHazards(dt: number): void {
    for (const chunk of this.chunks) {
      if (chunk.hazards.length === 0) continue
      if (chunk.startZ < this.z - 26 || chunk.startZ - GAME.chunkLength > this.z + 14) continue
      for (const hazard of chunk.hazards) {
        if (!hazard.active) continue
        hazard.group.rotation.y += dt * 3
        hazard.group.rotation.z = Math.sin(this.time * 2 + hazard.phase) * 0.22
        hazard.group.position.y = hazard.y + Math.sin(this.time * 2.6 + hazard.phase) * 0.16
        if (this.phase !== 'running' || this.invulnerable > 0) continue
        if (Math.abs(this.x - hazard.x) > 0.95 || Math.abs(this.z - hazard.z) > 1.25) continue
        // 身体竖直方向要和危险物重叠，跳得够高可以越过去
        const bodyCenter = this.y + this.jumpHeight + 0.95
        if (Math.abs(hazard.y - bodyCenter) > 1) continue
        this.hitHazard(hazard)
      }
    }
  }

  private hitHazard(hazard: Hazard): void {
    const config = HAZARD_CONFIG[hazard.kind]
    this.health = Math.max(0, this.health - config.health)
    this.score = Math.max(0, this.score - config.penalty)
    this.hits += 1
    this.speed *= 0.86
    this.lateral = (this.x >= hazard.x ? 1 : -1) * 2.4
    this.invulnerable = 0.9
    this.shake = 0.75
    this.damageFlash = 0.85
    this.spray.burst(hazard.x, hazard.y, hazard.z, 14)
    hazard.active = false
    hazard.group.visible = false
    skiAudio.hit('rock')
    if (this.hasCrowdNearby()) skiAudio.gasp()
    this.pushToast(`−${config.penalty} 分 · 被${config.label}砸中，体力 −${config.health}`, 'bad')
    this.emitHud()

    if (this.health < 32 && !this.lowHealthWarned) {
      this.lowHealthWarned = true
      this.pushToast('体力不足，稳住方向！', 'bad')
    }
    if (this.health <= 0) this.finish('health')
  }

  /* ---------- 失控卡车 ---------- */

  private updateTruck(dt: number): void {
    if (this.truck) {
      this.truck.update(dt)
      if (this.truck.gone || this.truck.z > this.z + 42) {
        this.clearTruck()
        this.truckTimer = 32 + Math.random() * 22
      }
    }

    if (this.phase !== 'running') return
    if (this.truckTimer > 0) {
      this.truckTimer -= dt
      return
    }
    if (this.truck || this.distance < 350) return

    const side = Math.random() > 0.5 ? 1 : -1
    const truck = new Truck(side * 15, this.z - (70 + Math.random() * 25), -side)
    this.scene.add(truck.group)
    this.truck = truck
    this.truckTimer = 45
    skiAudio.horn()
    this.pushToast('小心！有卡车冲上雪道！', 'bad')
  }

  private checkTruckCollision(): void {
    const truck = this.truck
    if (!truck || this.invulnerable > 0) return
    if (Math.abs(this.x - truck.x) > 1.75) return
    if (Math.abs(this.z - truck.z) > 3.1) return
    this.hitTruck()
  }

  private hitTruck(): void {
    const damage = 26
    this.health = Math.max(0, this.health - damage)
    this.score = Math.max(0, this.score - 250)
    this.hits += 1
    this.speed *= 0.55
    this.lateral = (this.x >= (this.truck?.x ?? 0) ? 1 : -1) * 4.6
    this.invulnerable = 1.6
    this.shake = 1.2
    this.damageFlash = 1
    this.spray.burst(this.x, this.y + 0.5, this.z, 26)
    skiAudio.hit('rock')
    skiAudio.horn()
    if (this.hasCrowdNearby()) skiAudio.gasp()
    this.pushToast(`−250 分 · 被卡车撞飞！体力 −${damage}`, 'bad')
    this.emitHud()

    if (this.health < 32 && !this.lowHealthWarned) {
      this.lowHealthWarned = true
      this.pushToast('体力不足，稳住方向！', 'bad')
    }
    if (this.health <= 0) this.finish('health')
  }

  private clearTruck(): void {
    if (!this.truck) return
    this.truck.dispose()
    this.truck = null
  }

  private updateMilestones(): void {
    while (this.distance >= this.nextMilestone) {
      this.score += 150
      skiAudio.milestone()
      this.pushToast(`滑行 ${this.nextMilestone} m · +150`, 'good')
      this.nextMilestone += 250
    }
  }

  private hasCrowdNearby(): boolean {
    for (const chunk of this.chunks) {
      for (const spectator of chunk.spectators) {
        if (Math.abs(spectator.z - this.z) < 34) return true
      }
    }
    return false
  }

  private updateSpectators(dt: number): void {
    this.cheerCooldown = Math.max(0, this.cheerCooldown - dt)
    let closest = 0
    for (const chunk of this.chunks) {
      for (const spectator of chunk.spectators) {
        const distance = Math.abs(spectator.z - this.z)
        if (distance > 72) continue
        if (distance < 34) closest = Math.max(closest, 1 - distance / 34)
        this.animateSpectator(spectator)
      }
    }
    skiAudio.updateCrowd(closest)
  }

  private animateSpectator(spectator: Spectator): void {
    const distance = Math.abs(spectator.z - this.z)
    const near = distance < 34
    const energy = near ? 1 : 0.35
    const wave = Math.sin(this.time * 6.5 + spectator.phase)
    spectator.body.position.y = Math.abs(Math.sin(this.time * 5.2 + spectator.phase)) * 0.11 * energy
    spectator.body.rotation.z = Math.sin(this.time * 3.1 + spectator.phase) * 0.035 * energy
    spectator.arms.forEach((arm, index) => {
      const side = index === 0 ? -1 : 1
      arm.rotation.z = side * (0.18 + Math.abs(wave) * 0.55 * energy)
      arm.rotation.x = Math.sin(this.time * 7 + spectator.phase + index) * 0.22 * energy - 0.12
    })

    if (near && !spectator.celebrated) {
      spectator.celebrated = true
      if (this.cheerCooldown <= 0) {
        this.cheerCooldown = 3.2
        skiAudio.cheer()
        this.pushToast('观众在为你加油！', 'info')
      }
    }
  }

  private updateCamera(dt: number, snap: boolean): void {
    const portrait = window.innerWidth / Math.max(1, window.innerHeight) < 0.82
    const speedFactor = Math.min(1, this.speed / 42)
    const over = this.phase === 'over'
    const back = (over ? 7.2 : 8.2) + speedFactor * 2.4 + (portrait ? 2.4 : 0)
    const height = (over ? 3.8 : 4.5) + speedFactor * 0.7 + (portrait ? 1.2 : 0)
    const jumpLift = this.jumpHeight * 0.28
    this.desiredCamera.set(this.x * 0.55, this.y + height + jumpLift, this.z + back)
    if (snap) {
      this.camera.position.copy(this.desiredCamera)
    } else {
      this.camera.position.lerp(this.desiredCamera, 1 - Math.exp(-dt * 4.6))
    }

    const lookAhead = over ? 4 : 13
    const lookY = heightAt(this.z - lookAhead) + (over ? 0.7 : 1.7) + this.jumpHeight * (over ? 0.2 : 0.22)
    this.desiredLook.set(this.x * 0.72, lookY, this.z - lookAhead)
    if (snap) this.lookTarget.copy(this.desiredLook)
    else this.lookTarget.lerp(this.desiredLook, 1 - Math.exp(-dt * 5.2))

    if (this.shake > 0) {
      this.camera.position.x += (Math.random() - 0.5) * this.shake * 0.35
      this.camera.position.y += (Math.random() - 0.5) * this.shake * 0.28
    }
    this.camera.lookAt(this.lookTarget)

    const fovTarget =
      (portrait ? 63 : 55) + speedFactor * 9 + Math.min(1, this.jumpHeight / 3) * 3
    this.camera.fov += (fovTarget - this.camera.fov) * Math.min(1, dt * 3)
    this.camera.updateProjectionMatrix()
  }

  private snapCamera(): void {
    this.updateCamera(0.016, true)
  }

  private updateWorldVisuals(dt: number): void {
    this.sky.position.copy(this.camera.position)
    this.backdrop.position.set(this.camera.position.x, this.camera.position.y - 12, this.camera.position.z)
    this.sun.position.set(this.x - 30, this.y + 58, this.z + 24)
    this.sunTarget.position.set(this.x, this.y, this.z - 10)
    this.sunTarget.updateMatrixWorld()
    this.snowfall.update(dt, this.camera)
    this.spray.update(dt)
  }

  private updateHud(dt: number): void {
    this.hudTimer -= dt
    if (this.hudTimer > 0) return
    this.hudTimer = this.damageFlash > 0 ? 0.04 : 0.09
    this.emitHud()
  }

  private emitHud(): void {
    const slope = Math.atan(slopeAt(this.z)) * (180 / Math.PI)
    const hud: HudSnapshot = {
      score: Math.round(this.score),
      distance: Math.floor(this.distance),
      speed: Math.round(this.speed * 3.6),
      health: Math.round(this.health),
      slope: Math.round(slope),
      hits: this.hits,
      best: 0,
      danger: Math.max(0, 1 - this.health / GAME.maxHealth),
      damageFlash: this.damageFlash,
      airborne: this.airborne,
    }
    this.options.onHud(hud)
  }

  private pushToast(text: string, tone: ToastTone): void {
    this.options.onToast({ text, tone })
  }

  private finish(reason: 'health' | 'quit'): void {
    if (this.phase === 'over') return
    this.phase = 'over'
    this.speed = 0
    this.airborne = false
    this.jumpHeight = 0
    this.jumpVelocity = 0
    this.clearInputs()
    this.skier.crash()
    skiAudio.stopAmbience()
    if (reason === 'quit') skiAudio.ui()
    this.emitHud()
    this.options.onGameOver({
      score: Math.round(this.score),
      distance: Math.floor(this.distance),
      hits: this.hits,
      reason,
      maxSpeed: this.maxSpeed,
    })
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    window.removeEventListener('keydown', this.onKeyDown)
    window.removeEventListener('keyup', this.onKeyUp)
    window.removeEventListener('blur', this.onBlur)
    skiAudio.stopAmbience()
    this.clearRivals()
    this.clearTruck()
    this.clearEffects()
    for (const chunk of this.chunks) disposeChunk(chunk)
    this.chunks.length = 0
    this.branches.length = 0
    this.snowfall.dispose()
    this.spray.dispose()
    this.marker?.traverse(object => {
      const mesh = object as THREE.Mesh
      mesh.geometry?.dispose()
    })
    this.markerMaterials?.forEach(material => material.dispose())
    this.skier.dispose()
    this.scene.remove(this.sky)
    this.skyGeometry.dispose()
    this.skyMaterial.dispose()
    this.scene.remove(this.backdrop)
    this.backdrop.traverse(object => {
      const mesh = object as THREE.Mesh
      const material = mesh.material
      if (material instanceof THREE.Material && material !== this.assets.snowMaterial) material.dispose()
    })
    this.mountainMaterial.dispose()
    this.scene.remove(this.sun)
    this.scene.remove(this.hemiLight)
    this.scene.remove(this.fillLight)
    this.scene.remove(this.sunTarget)
    this.sun.shadow.map?.dispose()
    this.assets.dispose()
    this.scene.fog = null
  }
}
