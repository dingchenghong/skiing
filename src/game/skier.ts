import * as THREE from 'three'
import type { JacketOption } from './data'

export type SkierAction = 'punch' | 'kick' | 'bomb'

export interface SkierPose {
  pitch: number
  yaw: number
  lean: number
  speed: number
  steering: number
  braking: boolean
  time: number
  airborne: boolean
  airHeight: number
  /** 当前正在播的动作 */
  action?: SkierAction | null
  /** 动作进度 0 ~ 1 */
  actionProgress?: number
  /** 出手方向：-1 左侧，1 右侧 */
  actionSide?: number
  /** 摇杆画圈带来的身体旋转角度（弧度，顺时针为正） */
  spin?: number
}

/** 程序化低模滑雪员，背对镜头、朝 -Z 下滑 */
export class Skier {
  readonly group = new THREE.Group()
  private tilt = new THREE.Group()
  private jacketMaterial: THREE.MeshStandardMaterial
  private accentMaterial: THREE.MeshStandardMaterial
  private skiMaterial: THREE.MeshStandardMaterial
  private bibMaterial: THREE.MeshStandardMaterial
  private arms: THREE.Group[] = []
  private legs: THREE.Group[] = []
  private skis: THREE.Mesh[] = []
  private head: THREE.Group | null = null
  private crashed = false
  private crashTime = 0
  private bibTexture: THREE.CanvasTexture

  constructor(jacket: JacketOption) {
    this.group.name = 'skier'
    this.group.add(this.tilt)

    this.jacketMaterial = new THREE.MeshStandardMaterial({
      color: jacket.color,
      roughness: 0.58,
      metalness: 0.08,
    })
    this.accentMaterial = new THREE.MeshStandardMaterial({
      color: jacket.accent,
      roughness: 0.48,
      metalness: 0.12,
    })
    this.skiMaterial = new THREE.MeshStandardMaterial({
      color: '#142838',
      roughness: 0.38,
      metalness: 0.35,
    })
    this.bibTexture = this.makeBibTexture(jacket.accent)
    this.bibMaterial = new THREE.MeshStandardMaterial({ map: this.bibTexture, roughness: 0.7 })

    const pants = new THREE.MeshStandardMaterial({ color: '#1b2a3a', roughness: 0.72 })
    const skin = new THREE.MeshStandardMaterial({ color: '#e8b58d', roughness: 0.85 })
    const dark = new THREE.MeshStandardMaterial({ color: '#101a26', roughness: 0.55 })
    const boot = new THREE.MeshStandardMaterial({ color: '#0b131c', roughness: 0.5 })
    const goggleFrame = new THREE.MeshStandardMaterial({ color: '#0a1520', roughness: 0.4 })
    const lens = new THREE.MeshStandardMaterial({
      color: '#6fe4ff',
      emissive: '#195b74',
      emissiveIntensity: 0.5,
      roughness: 0.15,
      metalness: 0.65,
    })
    const poleMaterial = new THREE.MeshStandardMaterial({
      color: '#cfdbe4',
      roughness: 0.28,
      metalness: 0.75,
    })

    const add = (mesh: THREE.Mesh): THREE.Mesh => {
      mesh.castShadow = true
      mesh.receiveShadow = false
      this.tilt.add(mesh)
      return mesh
    }

    // 雪板
    const skiGeo = new THREE.BoxGeometry(0.16, 0.055, 2.15)
    for (const side of [-1, 1]) {
      const ski = add(new THREE.Mesh(skiGeo, this.skiMaterial))
      ski.position.set(side * 0.3, 0.09, 0.04)
      ski.rotation.y = side * 0.035
      this.skis.push(ski)

      const tip = add(new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.055, 0.42), this.accentMaterial))
      tip.position.set(side * 0.3, 0.16, -1.02)
      tip.rotation.x = -0.42
      tip.rotation.y = side * 0.035

      const binding = add(new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.07, 0.3), dark))
      binding.position.set(side * 0.3, 0.15, 0.1)
    }

    // 靴子与腿：腿挂在髋部枢轴上，方便做踢腿动作
    const legGeo = new THREE.CylinderGeometry(0.085, 0.095, 0.72, 8)
    for (const side of [-1, 1]) {
      const hip = new THREE.Group()
      hip.position.set(side * 0.25, 1.06, 0.12)
      hip.rotation.x = 0.18
      this.tilt.add(hip)
      this.legs.push(hip)

      const leg = new THREE.Mesh(legGeo, pants)
      leg.position.y = -0.36
      leg.castShadow = true
      hip.add(leg)

      // 靴子跟着髋部一起摆，位置与之前的静态造型保持一致
      const bootMesh = new THREE.Mesh(new THREE.BoxGeometry(0.19, 0.17, 0.42), boot)
      bootMesh.position.set(side * 0.03, -0.8, 0.125)
      bootMesh.castShadow = true
      hip.add(bootMesh)
    }

    // 躯干
    const torso = add(new THREE.Mesh(new THREE.CapsuleGeometry(0.27, 0.42, 5, 12), this.jacketMaterial))
    torso.position.set(0, 1.24, 0.01)
    torso.rotation.x = 0.1

    const hip = add(new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.25, 0.32), pants))
    hip.position.set(0, 0.92, 0.05)

    const chestStripe = add(new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.09, 0.02), this.accentMaterial))
    chestStripe.position.set(0, 1.32, -0.27)
    chestStripe.rotation.x = 0.1

    const scarf = add(new THREE.Mesh(new THREE.TorusGeometry(0.19, 0.055, 6, 14), this.accentMaterial))
    scarf.position.set(0, 1.53, 0.02)
    scarf.rotation.x = Math.PI / 2

    // 头与护目镜
    const headGroup = new THREE.Group()
    headGroup.position.set(0, 1.72, 0.02)
    this.tilt.add(headGroup)
    this.head = headGroup

    const face = new THREE.Mesh(new THREE.SphereGeometry(0.18, 14, 10), skin)
    face.castShadow = true
    headGroup.add(face)

    const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.2, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.62), dark)
    helmet.position.y = 0.035
    helmet.castShadow = true
    headGroup.add(helmet)

    const helmetStripe = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.03, 0.3), this.accentMaterial)
    helmetStripe.position.set(0, 0.18, 0)
    headGroup.add(helmetStripe)

    const goggleBand = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.09, 0.06), goggleFrame)
    goggleBand.position.set(0, 0.03, -0.16)
    headGroup.add(goggleBand)

    const lensMesh = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.07, 0.018), lens)
    lensMesh.position.set(0, 0.03, -0.195)
    headGroup.add(lensMesh)

    // 双臂与雪杖
    const armGeo = new THREE.CylinderGeometry(0.065, 0.075, 0.5, 8)
    const poleGeo = new THREE.CylinderGeometry(0.016, 0.016, 1.25, 6)
    const poleRingGeo = new THREE.TorusGeometry(0.08, 0.014, 5, 10)
    for (const side of [-1, 1]) {
      const shoulder = new THREE.Group()
      shoulder.position.set(side * 0.31, 1.42, 0)
      shoulder.rotation.z = side * 0.22
      shoulder.rotation.x = -0.45
      this.tilt.add(shoulder)
      this.arms.push(shoulder)

      const arm = new THREE.Mesh(armGeo, this.jacketMaterial)
      arm.position.y = -0.25
      arm.castShadow = true
      shoulder.add(arm)

      const glove = new THREE.Mesh(new THREE.SphereGeometry(0.085, 8, 6), dark)
      glove.position.y = -0.52
      shoulder.add(glove)

      const pole = new THREE.Mesh(poleGeo, poleMaterial)
      pole.position.set(0, -0.76, 0.22)
      pole.rotation.x = -0.52
      pole.castShadow = true
      shoulder.add(pole)

      const ring = new THREE.Mesh(poleRingGeo, poleMaterial)
      ring.position.set(0, -1.18, 0.59)
      ring.rotation.x = Math.PI / 2 - 0.3
      shoulder.add(ring)
    }

    // 背后的号码布，让第三人称更有辨识度
    const bib = new THREE.Mesh(new THREE.PlaneGeometry(0.36, 0.32), this.bibMaterial)
    bib.position.set(0, 1.26, 0.285)
    bib.castShadow = false
    this.tilt.add(bib)

    this.group.scale.setScalar(1.05)
    this.setJacket(jacket)
  }

  private makeBibTexture(accent: string): THREE.CanvasTexture {
    const canvas = document.createElement('canvas')
    canvas.width = 128
    canvas.height = 112
    const ctx = canvas.getContext('2d')
    if (ctx) {
      ctx.fillStyle = '#0c1b2a'
      ctx.fillRect(0, 0, 128, 112)
      ctx.fillStyle = accent
      ctx.fillRect(0, 0, 128, 10)
      ctx.fillRect(0, 102, 128, 10)
      ctx.fillStyle = '#ffffff'
      ctx.font = '800 52px system-ui, sans-serif'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText('07', 64, 58)
    }
    const texture = new THREE.CanvasTexture(canvas)
    texture.colorSpace = THREE.SRGBColorSpace
    return texture
  }

  setJacket(jacket: JacketOption): void {
    this.jacketMaterial.color.set(jacket.color)
    this.accentMaterial.color.set(jacket.accent)
    this.skiMaterial.color.set(jacket.color).multiplyScalar(0.55)
    this.bibTexture.dispose()
    this.bibTexture = this.makeBibTexture(jacket.accent)
    this.bibMaterial.map = this.bibTexture
    this.bibMaterial.needsUpdate = true
  }

  update(dt: number, pose: SkierPose): void {
    const speedFactor = Math.min(1, pose.speed / 25)
    if (this.crashed) {
      this.crashTime += dt
      const t = Math.min(1, this.crashTime * 2.6)
      this.tilt.rotation.z = t * 2.3 * (pose.steering >= 0 ? 1 : -1)
      this.tilt.rotation.x = -t * 0.9
      this.tilt.position.y = -t * 0.15
      this.tilt.position.z = t * 0.25
      return
    }

    const cadence = pose.time * (2.2 + speedFactor * 5)
    const air = pose.airborne ? Math.min(1, pose.airHeight / 3) : 0
    this.group.rotation.y = pose.yaw
    this.tilt.rotation.x = pose.pitch + air * 0.16
    this.tilt.rotation.y = 0
    this.tilt.rotation.z = pose.lean + Math.sin(pose.time * 7.2) * 0.012 * speedFactor
    this.tilt.position.y = air * 0.035

    this.arms.forEach((arm, index) => {
      const swing = Math.sin(cadence + index * Math.PI) * (0.16 + speedFactor * 0.1) * (1 - air * 0.6)
      arm.rotation.x = (pose.airborne ? -0.72 : -0.45) + swing
      arm.rotation.y = 0
      arm.rotation.z = (index === 0 ? -1 : 1) * (0.22 + Math.abs(pose.steering) * 0.06 + air * 0.12)
    })

    this.legs.forEach(leg => {
      leg.rotation.x = 0.18
      leg.rotation.z = 0
    })

    this.skis.forEach((ski, index) => {
      const offset = Math.abs(pose.steering) * (index === 0 ? -1 : 1) * 0.015
      ski.position.y =
        0.09 +
        Math.sin(cadence * 0.5 + index) * 0.006 * speedFactor +
        (pose.braking ? offset : 0) +
        air * 0.045
    })

    if (this.head) {
      this.head.rotation.y = pose.steering * 0.16
      this.head.rotation.z = -pose.steering * 0.05
    }

    this.applyAction(pose)
    // 摇杆顺时针画圈（spin 为正）对应俯视顺时针转体，绕 Y 轴就是负方向
    const spin = pose.spin ?? 0
    if (spin !== 0) this.tilt.rotation.y -= spin
  }

  /** 挥杆 / 飞踢 / 丢爆弹的动作特写 */
  private applyAction(pose: SkierPose): void {
    const action = pose.action ?? null
    if (!action) return
    const t = Math.max(0, Math.min(1, pose.actionProgress ?? 0))
    // 先蓄力再发力：中段幅度最大，收尾回到滑行姿态
    const swing = Math.sin(Math.min(1, t * 1.15) * Math.PI)
    const side = (pose.actionSide ?? 1) >= 0 ? 1 : -1

    if (action === 'punch') {
      // 目标在哪边就用哪只手，另一边的手臂向后拉开保持平衡
      const arm = this.arms[side > 0 ? 1 : 0]
      const offArm = this.arms[side > 0 ? 0 : 1]
      if (arm) {
        // 手臂先向外侧抬起，再朝前方横扫出去
        arm.rotation.x = -0.45 + swing * 0.75
        arm.rotation.z = side * (0.22 + swing * 1.25)
        arm.rotation.y = side * swing * 0.7
      }
      if (offArm) {
        offArm.rotation.x = -0.45 - swing * 0.5
        offArm.rotation.z = -side * (0.22 + swing * 0.35)
      }
      // 身体朝出拳侧拧一下，同时向那一侧压重心
      this.tilt.rotation.y = -side * swing * 0.4
      this.tilt.rotation.z -= side * swing * 0.17
      this.tilt.position.y -= swing * 0.035
      if (this.head) this.head.rotation.y -= side * swing * 0.3
      return
    }

    if (action === 'kick') {
      // 目标在哪边就抬哪条腿，支撑腿微屈，身体向反方向侧倾
      const leg = this.legs[side > 0 ? 1 : 0]
      const supportLeg = this.legs[side > 0 ? 0 : 1]
      if (leg) {
        leg.rotation.x = 0.18 + swing * 1.7
        leg.rotation.z = side * swing * 0.42
      }
      if (supportLeg) supportLeg.rotation.x = 0.18 + swing * 0.16
      this.arms.forEach((arm, index) => {
        const armSide = index === 0 ? -1 : 1
        arm.rotation.x = -0.45 - swing * 0.35
        arm.rotation.z = armSide * (0.22 + swing * 0.55)
      })
      this.tilt.rotation.y = -side * swing * 0.32
      this.tilt.rotation.z += side * swing * 0.28
      this.tilt.position.y -= swing * 0.02
      if (this.head) this.head.rotation.y -= side * swing * 0.28
      return
    }

    // 丢爆弹：双臂向后甩，身体略微下蹲
    this.arms.forEach((arm, index) => {
      arm.rotation.x = -0.45 + swing * 0.85
      arm.rotation.z = (index === 0 ? -1 : 1) * (0.22 + swing * 0.25)
    })
    this.tilt.rotation.x += swing * 0.14
    this.tilt.position.y -= swing * 0.05
  }

  crash(): void {
    this.crashed = true
    this.crashTime = 0
  }

  resetPose(): void {
    this.crashed = false
    this.crashTime = 0
    this.tilt.rotation.set(0, 0, 0)
    this.tilt.position.set(0, 0, 0)
    this.group.rotation.set(0, 0, 0)
  }

  dispose(): void {
    const materials = new Set<THREE.Material>()
    const geometries = new Set<THREE.BufferGeometry>()
    this.group.traverse(object => {
      const mesh = object as THREE.Mesh
      if (mesh.geometry) geometries.add(mesh.geometry)
      const material = mesh.material
      if (!material) return
      const list = Array.isArray(material) ? material : [material]
      list.forEach(item => {
        materials.add(item)
        if (item instanceof THREE.MeshStandardMaterial && item.map) item.map.dispose()
      })
    })
    geometries.forEach(geometry => geometry.dispose())
    materials.forEach(material => material.dispose())
    this.bibTexture.dispose()
    this.group.removeFromParent()
  }
}
