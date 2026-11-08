import * as THREE from 'three'
import { GAME, JACKETS, OBSTACLE_CONFIG, type HazardKind, type ObstacleKind } from './data'
import { courseHalfWidthAt, heightAt } from './terrain'

export interface Obstacle {
  kind: ObstacleKind
  x: number
  z: number
  radius: number
  group: THREE.Group
  active: boolean
}

export interface Spectator {
  group: THREE.Group
  body: THREE.Group
  arms: THREE.Group[]
  phase: number
  z: number
  side: number
  celebrated: boolean
}

export type PickupKind = 'snowflake' | 'bread' | 'icecream' | 'diamond' | 'shield'

export interface Pickup {
  kind: PickupKind
  x: number
  y: number
  z: number
  group: THREE.Group
  taken: boolean
  phase: number
  /** 同一串奖励共享的计数，收满整串额外加分 */
  trail: { total: number; got: number }
}

/** 飘在空中的危险物，碰到会掉体力 */
export interface Hazard {
  kind: HazardKind
  x: number
  y: number
  z: number
  group: THREE.Group
  active: boolean
  phase: number
}

/** 一段 Y 形岔道：中间长出分隔雪脊，把雪道分成左右两条 */
export interface Branch {
  startZ: number
  endZ: number
  /** 分隔带最宽处的一半宽度 */
  divide: number
  /** 是否已经弹过提示 */
  seen?: boolean
}

export interface Chunk {
  startZ: number
  group: THREE.Group
  obstacles: Obstacle[]
  spectators: Spectator[]
  pickups: Pickup[]
  hazards: Hazard[]
  terrainGeometry: THREE.BufferGeometry
  branch: Branch | null
}

const TERRAIN_WIDTH = 34
const TERRAIN_X_SEGMENTS = 18
const TERRAIN_Z_SEGMENTS = 10
const FORK_LENGTH = 54
const FORK_DIVIDE = 3.3

function setShadow(mesh: THREE.Mesh, cast = false, receive = false): THREE.Mesh {
  mesh.castShadow = cast
  mesh.receiveShadow = receive
  return mesh
}

function makeCheerTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 360
  canvas.height = 120
  const ctx = canvas.getContext('2d')
  if (ctx) {
    const gradient = ctx.createLinearGradient(0, 0, canvas.width, canvas.height)
    gradient.addColorStop(0, '#ff9a3d')
    gradient.addColorStop(1, '#ff5f7e')
    ctx.fillStyle = gradient
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.strokeStyle = 'rgba(255,255,255,0.9)'
    ctx.lineWidth = 7
    ctx.strokeRect(5, 5, canvas.width - 10, canvas.height - 10)
    ctx.fillStyle = '#ffffff'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.font = '900 52px system-ui, sans-serif'
    ctx.fillText('加油！', canvas.width / 2, 60)
    ctx.font = '700 15px system-ui, sans-serif'
    ctx.fillStyle = 'rgba(255,255,255,0.82)'
    ctx.fillText('GO · GO · GO', canvas.width / 2, 97)
  }
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}

export class WorldAssets {
  readonly terrainMaterial: THREE.MeshStandardMaterial
  readonly snowMaterial: THREE.MeshStandardMaterial
  readonly snowSoftMaterial: THREE.MeshStandardMaterial
  readonly snowShadeMaterial: THREE.MeshStandardMaterial
  readonly trunkMaterial: THREE.MeshStandardMaterial
  readonly pineMaterial: THREE.MeshStandardMaterial
  readonly pineDarkMaterial: THREE.MeshStandardMaterial
  readonly rockMaterial: THREE.MeshStandardMaterial
  readonly iceMaterial: THREE.MeshStandardMaterial
  readonly logMaterial: THREE.MeshStandardMaterial
  readonly woodMaterial: THREE.MeshStandardMaterial
  readonly glassMaterial: THREE.MeshStandardMaterial
  readonly darkMaterial: THREE.MeshStandardMaterial
  readonly pantsMaterial: THREE.MeshStandardMaterial
  readonly skinMaterial: THREE.MeshStandardMaterial
  readonly flagMaterials: THREE.MeshStandardMaterial[]
  readonly spectatorJackets: THREE.MeshStandardMaterial[]
  readonly pickupMaterials: Record<PickupKind, THREE.MeshStandardMaterial>
  readonly dangerMaterial: THREE.MeshStandardMaterial
  readonly bladeMaterial: THREE.MeshStandardMaterial
  readonly handleMaterial: THREE.MeshStandardMaterial
  readonly chocolateMaterial: THREE.MeshStandardMaterial

  readonly sphere: THREE.SphereGeometry
  readonly cone: THREE.ConeGeometry
  readonly cylinder: THREE.CylinderGeometry
  readonly box: THREE.BoxGeometry
  readonly rockGeometry: THREE.DodecahedronGeometry
  readonly limb: THREE.CylinderGeometry
  readonly capsule: THREE.CapsuleGeometry
  readonly flag: THREE.PlaneGeometry
  readonly ring: THREE.TorusGeometry
  readonly banner: THREE.PlaneGeometry
  readonly octa: THREE.OctahedronGeometry
  readonly cheerMaterial: THREE.MeshBasicMaterial
  private readonly cheerTexture: THREE.CanvasTexture

  constructor() {
    this.terrainMaterial = new THREE.MeshStandardMaterial({
      color: '#ffffff',
      vertexColors: true,
      roughness: 0.96,
      metalness: 0,
    })
    this.snowMaterial = new THREE.MeshStandardMaterial({ color: '#f8fcff', roughness: 0.92 })
    this.snowSoftMaterial = new THREE.MeshStandardMaterial({ color: '#e6f1fb', roughness: 1 })
    this.snowShadeMaterial = new THREE.MeshStandardMaterial({ color: '#d7e6f4', roughness: 1 })
    this.trunkMaterial = new THREE.MeshStandardMaterial({ color: '#5c4130', roughness: 0.95 })
    this.pineMaterial = new THREE.MeshStandardMaterial({ color: '#2d5a47', roughness: 0.88 })
    this.pineDarkMaterial = new THREE.MeshStandardMaterial({ color: '#244b3b', roughness: 0.9 })
    this.rockMaterial = new THREE.MeshStandardMaterial({ color: '#758390', roughness: 0.95 })
    this.iceMaterial = new THREE.MeshStandardMaterial({ color: '#b8dcf2', roughness: 0.25, metalness: 0.2 })
    this.logMaterial = new THREE.MeshStandardMaterial({ color: '#6b4930', roughness: 0.92 })
    this.woodMaterial = new THREE.MeshStandardMaterial({ color: '#805d3b', roughness: 0.9 })
    this.glassMaterial = new THREE.MeshStandardMaterial({
      color: '#ffd28a',
      emissive: '#ff9a3c',
      emissiveIntensity: 1.4,
      roughness: 0.3,
    })
    this.darkMaterial = new THREE.MeshStandardMaterial({ color: '#16212d', roughness: 0.65 })
    this.pantsMaterial = new THREE.MeshStandardMaterial({ color: '#263544', roughness: 0.82 })
    this.skinMaterial = new THREE.MeshStandardMaterial({ color: '#e6b38b', roughness: 0.85 })
    this.flagMaterials = ['#ff8a3d', '#39bdf8', '#ffd23f', '#f4527a', '#37c28c'].map(
      color => new THREE.MeshStandardMaterial({ color, roughness: 0.65, side: THREE.DoubleSide }),
    )
    this.spectatorJackets = JACKETS.map(
      jacket =>
        new THREE.MeshStandardMaterial({
          color: jacket.color,
          roughness: 0.72,
          metalness: 0.04,
        }),
    )
    this.pickupMaterials = {
      snowflake: new THREE.MeshStandardMaterial({
        color: '#8ce8ff',
        emissive: '#2ea7d6',
        emissiveIntensity: 1.1,
        roughness: 0.25,
        metalness: 0.35,
      }),
      bread: new THREE.MeshStandardMaterial({
        color: '#e8b874',
        emissive: '#b57322',
        emissiveIntensity: 0.55,
        roughness: 0.75,
        metalness: 0.05,
      }),
      icecream: new THREE.MeshStandardMaterial({
        color: '#f6e7c4',
        emissive: '#e0a94a',
        emissiveIntensity: 0.5,
        roughness: 0.6,
        metalness: 0.05,
      }),
      diamond: new THREE.MeshStandardMaterial({
        color: '#d8f4ff',
        emissive: '#58c8ff',
        emissiveIntensity: 1.3,
        roughness: 0.12,
        metalness: 0.8,
      }),
      shield: new THREE.MeshStandardMaterial({
        color: '#c0a8ff',
        emissive: '#6b46e0',
        emissiveIntensity: 1.0,
        roughness: 0.25,
        metalness: 0.45,
      }),
    }
    this.dangerMaterial = new THREE.MeshStandardMaterial({
      color: '#ff5b5b',
      emissive: '#c01030',
      emissiveIntensity: 0.9,
      roughness: 0.35,
      metalness: 0.3,
    })
    this.bladeMaterial = new THREE.MeshStandardMaterial({
      color: '#dfe7ee',
      emissive: '#5d7c93',
      emissiveIntensity: 0.35,
      roughness: 0.2,
      metalness: 0.95,
    })
    this.handleMaterial = new THREE.MeshStandardMaterial({
      color: '#d8283a',
      emissive: '#7a0d18',
      emissiveIntensity: 0.5,
      roughness: 0.55,
      metalness: 0.1,
    })
    this.chocolateMaterial = new THREE.MeshStandardMaterial({
      color: '#6b3d22',
      emissive: '#361708',
      emissiveIntensity: 0.3,
      roughness: 0.7,
      metalness: 0.05,
    })

    this.sphere = new THREE.SphereGeometry(1, 12, 9)
    this.cone = new THREE.ConeGeometry(1, 1, 8)
    this.cylinder = new THREE.CylinderGeometry(1, 1, 1, 8)
    this.box = new THREE.BoxGeometry(1, 1, 1)
    this.rockGeometry = new THREE.DodecahedronGeometry(1, 0)
    this.limb = new THREE.CylinderGeometry(0.075, 0.09, 1, 7)
    this.capsule = new THREE.CapsuleGeometry(0.3, 0.5, 4, 10)
    this.flag = new THREE.PlaneGeometry(0.52, 0.32)
    this.ring = new THREE.TorusGeometry(1, 0.09, 5, 12)
    this.octa = new THREE.OctahedronGeometry(0.5, 0)
    this.cheerTexture = makeCheerTexture()
    this.cheerMaterial = new THREE.MeshBasicMaterial({
      map: this.cheerTexture,
      transparent: true,
      side: THREE.DoubleSide,
      depthWrite: false,
    })
    this.banner = new THREE.PlaneGeometry(2.7, 0.92)
  }

  dispose(): void {
    const geometries = [
      this.sphere,
      this.cone,
      this.cylinder,
      this.box,
      this.rockGeometry,
      this.limb,
      this.capsule,
      this.flag,
      this.ring,
      this.banner,
      this.octa,
    ]
    geometries.forEach(geometry => geometry.dispose())

    const materials: THREE.Material[] = [
      this.terrainMaterial,
      this.snowMaterial,
      this.snowSoftMaterial,
      this.snowShadeMaterial,
      this.trunkMaterial,
      this.pineMaterial,
      this.pineDarkMaterial,
      this.rockMaterial,
      this.iceMaterial,
      this.logMaterial,
      this.woodMaterial,
      this.glassMaterial,
      this.darkMaterial,
      this.pantsMaterial,
      this.skinMaterial,
      this.cheerMaterial,
      ...this.flagMaterials,
      ...this.spectatorJackets,
      ...Object.values(this.pickupMaterials),
      this.dangerMaterial,
      this.bladeMaterial,
      this.handleMaterial,
      this.chocolateMaterial,
    ]
    materials.forEach(material => material.dispose())
    this.cheerTexture.dispose()
  }
}

function buildTerrainGeometry(startZ: number): { geometry: THREE.BufferGeometry } {
  const positions: number[] = []
  const colors: number[] = []
  const indices: number[] = []
  const color = new THREE.Color()
  const centerColor = new THREE.Color('#e4f1fe')
  const edgeColor = new THREE.Color('#fbfdff')
  const grooveColor = new THREE.Color('#edf7ff')

  for (let iz = 0; iz <= TERRAIN_Z_SEGMENTS; iz++) {
    const z = startZ - (iz / TERRAIN_Z_SEGMENTS) * GAME.chunkLength
    for (let ix = 0; ix <= TERRAIN_X_SEGMENTS; ix++) {
      const x = -TERRAIN_WIDTH / 2 + (ix / TERRAIN_X_SEGMENTS) * TERRAIN_WIDTH
      const ripple = 0.035 * Math.sin(x * 0.75 + z * 0.31) + 0.018 * Math.sin(x * 1.9 - z * 0.8)
      const width = courseHalfWidthAt(z)
      const edge = Math.min(1, Math.max(0, (Math.abs(x) - (width - 0.6)) / 4.4))
      const path = 1 - edge
      const groove = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(x * 2.6 + z * 0.1))
      color.copy(centerColor).lerp(edgeColor, edge)
      color.lerp(grooveColor, path * groove * 0.32)
      positions.push(x, heightAt(z) + ripple, z)
      colors.push(color.r, color.g, color.b)
    }
  }

  for (let iz = 0; iz < TERRAIN_Z_SEGMENTS; iz++) {
    for (let ix = 0; ix < TERRAIN_X_SEGMENTS; ix++) {
      const row = TERRAIN_X_SEGMENTS + 1
      const a = iz * row + ix
      const b = a + 1
      const c = a + row
      const d = c + 1
      indices.push(a, c, b, b, c, d)
    }
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  return { geometry }
}

function buildPine(assets: WorldAssets, height: number, dark = false): THREE.Group {
  const group = new THREE.Group()
  const trunk = setShadow(
    new THREE.Mesh(assets.cylinder, assets.trunkMaterial),
    false,
    false,
  )
  trunk.scale.set(0.18 * height * 0.35, height * 0.46, 0.18 * height * 0.35)
  trunk.position.y = height * 0.23
  group.add(trunk)

  const layers = 3
  for (let layer = 0; layer < layers; layer++) {
    const t = layer / layers
    const radius = height * (0.32 - t * 0.075)
    const layerHeight = height * 0.4
    const foliage = setShadow(
      new THREE.Mesh(assets.cone, dark ? assets.pineDarkMaterial : assets.pineMaterial),
      false,
      false,
    )
    foliage.scale.set(radius, layerHeight, radius)
    foliage.position.y = height * (0.42 + t * 0.23)
    group.add(foliage)

    const cap = setShadow(new THREE.Mesh(assets.cone, assets.snowMaterial), false, false)
    cap.scale.set(radius * 0.82, layerHeight * 0.36, radius * 0.82)
    cap.position.y = height * (0.42 + t * 0.23) + layerHeight * 0.27
    group.add(cap)
  }
  return group
}

function buildSnowball(assets: WorldAssets): THREE.Group {
  const group = new THREE.Group()
  const main = setShadow(new THREE.Mesh(assets.sphere, assets.snowMaterial), true, false)
  main.scale.set(0.62, 0.58, 0.62)
  main.position.y = 0.48
  group.add(main)
  const left = setShadow(new THREE.Mesh(assets.sphere, assets.snowSoftMaterial), false, false)
  left.scale.set(0.38, 0.34, 0.38)
  left.position.set(-0.38, 0.3, 0.16)
  group.add(left)
  const right = setShadow(new THREE.Mesh(assets.sphere, assets.snowSoftMaterial), false, false)
  right.scale.set(0.32, 0.3, 0.32)
  right.position.set(0.36, 0.26, -0.13)
  group.add(right)
  const ice = setShadow(new THREE.Mesh(assets.rockGeometry, assets.iceMaterial), false, false)
  ice.scale.setScalar(0.16)
  ice.position.set(0.16, 0.92, -0.14)
  group.add(ice)
  return group
}

function buildRock(assets: WorldAssets): THREE.Group {
  const group = new THREE.Group()
  const rock = setShadow(new THREE.Mesh(assets.rockGeometry, assets.rockMaterial), true, false)
  rock.scale.set(0.92, 0.72, 0.84)
  rock.position.y = 0.56
  rock.rotation.set(0.4, 0.3, -0.15)
  group.add(rock)

  const cap = setShadow(new THREE.Mesh(assets.sphere, assets.snowMaterial), false, false)
  cap.scale.set(0.72, 0.16, 0.62)
  cap.position.set(0.02, 1.06, 0.02)
  group.add(cap)
  return group
}

function buildLog(assets: WorldAssets): THREE.Group {
  const group = new THREE.Group()
  const log = setShadow(new THREE.Mesh(assets.cylinder, assets.logMaterial), true, false)
  log.scale.set(0.28, 2.4, 0.28)
  log.rotation.z = Math.PI / 2
  log.position.y = 0.3
  group.add(log)

  const snow = setShadow(new THREE.Mesh(assets.box, assets.snowMaterial), false, false)
  snow.scale.set(2.3, 0.1, 0.35)
  snow.position.y = 0.62
  group.add(snow)

  const stump = setShadow(new THREE.Mesh(assets.cylinder, assets.trunkMaterial), false, false)
  stump.scale.set(0.38, 0.32, 0.38)
  stump.position.set(1.05, 0.22, 0.18)
  group.add(stump)
  return group
}

function buildObstacle(assets: WorldAssets, kind: ObstacleKind): THREE.Group {
  if (kind === 'snowball') return buildSnowball(assets)
  if (kind === 'rock') return buildRock(assets)
  if (kind === 'log') return buildLog(assets)
  return buildPine(assets, 2.6, true)
}

function buildSpectator(
  assets: WorldAssets,
  x: number,
  z: number,
  side: number,
  seed: number,
): Spectator {
  const group = new THREE.Group()
  group.position.set(x, heightAt(z), z)
  group.rotation.y = side > 0 ? -Math.PI / 2 : Math.PI / 2
  group.scale.setScalar(0.92 + (seed % 7) * 0.025)

  const body = new THREE.Group()
  group.add(body)

  const jacket = assets.spectatorJackets[Math.floor(Math.random() * assets.spectatorJackets.length)]!
  const torso = setShadow(new THREE.Mesh(assets.capsule, jacket), false, false)
  torso.position.y = 0.94
  torso.scale.set(0.9, 0.98, 0.85)
  body.add(torso)

  const head = setShadow(new THREE.Mesh(assets.sphere, assets.skinMaterial), false, false)
  head.scale.setScalar(0.18)
  head.position.y = 1.53
  body.add(head)

  const beanie = setShadow(
    new THREE.Mesh(
      assets.cone,
      assets.flagMaterials[Math.floor(Math.random() * assets.flagMaterials.length)]!,
    ),
    false,
    false,
  )
  beanie.scale.set(0.21, 0.27, 0.21)
  beanie.position.y = 1.69
  body.add(beanie)

  const scarf = setShadow(new THREE.Mesh(assets.ring, assets.flagMaterials[seed % assets.flagMaterials.length]!), false, false)
  scarf.scale.setScalar(0.18)
  scarf.position.y = 1.43
  scarf.rotation.x = Math.PI / 2
  body.add(scarf)

  const armGeo = assets.limb
  const arms: THREE.Group[] = []
  for (const armSide of [-1, 1]) {
    const pivot = new THREE.Group()
    pivot.position.set(armSide * 0.33, 1.17, 0)
    pivot.rotation.z = armSide * 0.18
    body.add(pivot)
    arms.push(pivot)

    const arm = setShadow(new THREE.Mesh(armGeo, jacket), false, false)
    arm.scale.set(0.9, 0.48, 0.9)
    arm.position.y = -0.24
    pivot.add(arm)

    const hand = new THREE.Mesh(assets.sphere, assets.skinMaterial)
    hand.scale.setScalar(0.085)
    hand.position.y = -0.5
    pivot.add(hand)
  }

  for (const legSide of [-1, 1]) {
    const leg = setShadow(new THREE.Mesh(armGeo, assets.pantsMaterial), false, false)
    leg.scale.set(1, 0.62, 1)
    leg.position.set(legSide * 0.15, 0.36, 0)
    body.add(leg)
    const boot = setShadow(new THREE.Mesh(assets.box, assets.darkMaterial), false, false)
    boot.scale.set(0.18, 0.14, 0.32)
    boot.position.set(legSide * 0.15, 0.08, -0.06)
    body.add(boot)
  }

  // 一半观众拿小旗子
  if (seed % 3 === 0) {
    const pole = setShadow(new THREE.Mesh(assets.cylinder, assets.darkMaterial), false, false)
    pole.scale.set(0.022, 1.2, 0.022)
    pole.position.set(0.42, 1.28, 0.04)
    body.add(pole)
    const flag = new THREE.Mesh(assets.flag, assets.flagMaterials[seed % assets.flagMaterials.length]!)
    flag.position.set(0.7, 1.78, 0.04)
    flag.rotation.y = 0.25
    body.add(flag)
  }

  return {
    group,
    body,
    arms,
    phase: Math.random() * Math.PI * 2,
    z,
    side,
    celebrated: false,
  }
}

function buildCabin(assets: WorldAssets, x: number, z: number): THREE.Group {
  const group = new THREE.Group()
  group.position.set(x, heightAt(z), z)
  group.rotation.y = Math.PI * 0.08

  const base = setShadow(new THREE.Mesh(assets.box, assets.woodMaterial), false, true)
  base.scale.set(3.2, 2, 3.4)
  base.position.y = 1
  group.add(base)

  const roof = setShadow(new THREE.Mesh(assets.box, assets.snowMaterial), false, false)
  roof.scale.set(3.7, 0.3, 3.9)
  roof.position.y = 2.08
  group.add(roof)

  const roofSnow = setShadow(new THREE.Mesh(assets.box, assets.snowSoftMaterial), false, false)
  roofSnow.scale.set(3.4, 0.2, 3.6)
  roofSnow.position.y = 2.26
  group.add(roofSnow)

  const chimney = setShadow(new THREE.Mesh(assets.box, assets.darkMaterial), false, false)
  chimney.scale.set(0.45, 1.1, 0.45)
  chimney.position.set(0.9, 2.35, -0.45)
  group.add(chimney)

  const door = setShadow(new THREE.Mesh(assets.box, assets.darkMaterial), false, false)
  door.scale.set(0.7, 1.2, 0.08)
  door.position.set(0, 0.7, 1.73)
  group.add(door)

  for (const side of [-1, 1]) {
    const window = new THREE.Mesh(assets.box, assets.glassMaterial)
    window.scale.set(0.75, 0.65, 0.08)
    window.position.set(side * 0.95, 1.25, 1.73)
    group.add(window)
  }

  return group
}

function buildStartGate(assets: WorldAssets): THREE.Group {
  const group = new THREE.Group()
  for (const side of [-1, 1]) {
    const pole = setShadow(new THREE.Mesh(assets.cylinder, assets.darkMaterial), false, false)
    pole.scale.set(0.08, 4.4, 0.08)
    pole.position.set(side * 8.3, 2.2, -5)
    group.add(pole)
  }

  const rope = setShadow(new THREE.Mesh(assets.cylinder, assets.woodMaterial), false, false)
  rope.scale.set(0.028, 16.6, 0.028)
  rope.rotation.z = Math.PI / 2
  rope.position.set(0, 4.2, -5)
  group.add(rope)

  for (let i = 0; i < 9; i++) {
    const flag = new THREE.Mesh(assets.flag, assets.flagMaterials[i % assets.flagMaterials.length]!)
    flag.scale.set(0.75, 0.85, 1)
    flag.position.set(-7.2 + i * 1.8, 3.75, -5)
    flag.rotation.z = -0.18
    group.add(flag)
  }

  return group
}

/** 空中奖励：面包 / 雪糕 / 发光道具 + 旋转光环 */
function buildPickup(assets: WorldAssets, kind: PickupKind): THREE.Group {
  const group = new THREE.Group()
  const material = assets.pickupMaterials[kind]

  if (kind === 'bread') {
    // 长条面包：横放的法棍 + 顶部三道割口
    const loaf = new THREE.Mesh(assets.capsule, material)
    loaf.scale.set(1.25, 1, 1.05)
    loaf.rotation.z = Math.PI / 2
    group.add(loaf)
    for (const offset of [-0.34, 0, 0.34]) {
      const cut = new THREE.Mesh(assets.box, assets.trunkMaterial)
      cut.scale.set(0.06, 0.07, 0.42)
      cut.position.set(offset, 0.28, 0)
      cut.rotation.set(0.25, 0, 0.45)
      group.add(cut)
    }
  } else if (kind === 'icecream') {
    // 雪糕：奶油方块 + 巧克力顶 + 木棍
    const bar = new THREE.Mesh(assets.box, material)
    bar.scale.set(0.66, 0.2, 0.92)
    group.add(bar)
    const dip = new THREE.Mesh(assets.box, assets.chocolateMaterial)
    dip.scale.set(0.68, 0.1, 0.36)
    dip.position.set(0, 0.12, -0.28)
    group.add(dip)
    const stick = new THREE.Mesh(assets.box, assets.woodMaterial)
    stick.scale.set(0.1, 0.06, 0.5)
    stick.position.set(0, -0.02, 0.66)
    group.add(stick)
  } else {
    const core = new THREE.Mesh(assets.octa, material)
    if (kind === 'diamond') core.scale.set(1.0, 1.65, 1.0)
    else core.scale.setScalar(1.35)
    core.rotation.y = Math.PI * 0.25
    group.add(core)
  }

  const ringA = new THREE.Mesh(assets.ring, material)
  ringA.scale.setScalar(1.05)
  ringA.rotation.x = Math.PI / 2
  group.add(ringA)

  const ringB = new THREE.Mesh(assets.ring, material)
  ringB.scale.setScalar(0.78)
  ringB.rotation.y = Math.PI / 2
  group.add(ringB)

  return group
}

/** 空中危险物：剪刀 / 冰锥 / 石块，外面套一圈红色警示光环 */
function buildHazard(assets: WorldAssets, kind: HazardKind): THREE.Group {
  const group = new THREE.Group()

  if (kind === 'scissors') {
    for (const dir of [-1, 1]) {
      const blade = new THREE.Mesh(assets.box, assets.bladeMaterial)
      blade.scale.set(0.09, 0.95, 0.05)
      blade.rotation.z = dir * 0.34
      blade.position.set(dir * 0.12, 0.2, 0)
      group.add(blade)
      const handle = new THREE.Mesh(assets.ring, assets.handleMaterial)
      handle.scale.setScalar(0.24)
      handle.position.set(dir * 0.32, dir * -0.55, 0)
      group.add(handle)
    }
    const screw = new THREE.Mesh(assets.sphere, assets.bladeMaterial)
    screw.scale.setScalar(0.1)
    group.add(screw)
  } else if (kind === 'icicle') {
    const spike = new THREE.Mesh(assets.cone, assets.dangerMaterial)
    spike.scale.set(0.3, 1.1, 0.3)
    spike.rotation.x = Math.PI
    group.add(spike)
    const tip = new THREE.Mesh(assets.cone, assets.iceMaterial)
    tip.scale.set(0.16, 0.5, 0.16)
    tip.position.y = -0.8
    tip.rotation.x = Math.PI
    group.add(tip)
  } else {
    const rock = new THREE.Mesh(assets.rockGeometry, assets.rockMaterial)
    rock.scale.set(0.5, 0.45, 0.48)
    rock.rotation.set(0.3, 0.5, -0.2)
    group.add(rock)
    const chunk = new THREE.Mesh(assets.rockGeometry, assets.dangerMaterial)
    chunk.scale.setScalar(0.22)
    chunk.position.set(0.32, 0.18, 0.1)
    group.add(chunk)
  }

  const halo = new THREE.Mesh(assets.ring, assets.dangerMaterial)
  halo.scale.setScalar(0.92)
  halo.rotation.x = Math.PI / 2
  group.add(halo)

  return group
}

/** Y 形岔口：中间一条隆起的分隔雪脊，上面点缀松树和岩石，两边各留一条雪道 */
function buildFork(assets: WorldAssets, startZ: number): THREE.Group {
  const group = new THREE.Group()
  const steps = 12

  // 分隔雪脊：从一个尖头慢慢长宽，再收拢回主道
  for (let i = 0; i <= steps; i++) {
    const t = i / steps
    const z = startZ - t * FORK_LENGTH
    const width = courseHalfWidthAt(z)
    const bend = Math.pow(Math.sin(Math.PI * t), 0.72)
    const half = Math.min(FORK_DIVIDE, width * 0.42) * bend
    if (half < 0.25) continue
    const ridge = new THREE.Mesh(assets.sphere, assets.snowSoftMaterial)
    ridge.scale.set(half, 0.34 + bend * 0.5, 1.5)
    ridge.position.set(0, heightAt(z) + 0.18, z)
    ridge.receiveShadow = true
    group.add(ridge)
  }

  // 两条车道中间的压雪痕迹，像真的雪道
  for (const side of [-1, 1]) {
    for (const index of [3, 6, 9, 12, 15]) {
      const t = index / 18
      const z = startZ - t * FORK_LENGTH
      const width = courseHalfWidthAt(z)
      const bend = Math.pow(Math.sin(Math.PI * t), 0.72)
      const divide = Math.min(FORK_DIVIDE, width * 0.42) * bend
      const laneCenter = side * (divide + (width - divide) * 0.5)
      const laneHalf = (width - divide) * 0.5
      const strip = new THREE.Mesh(assets.sphere, assets.snowShadeMaterial)
      strip.scale.set(laneHalf * 0.52, 0.045, 1.25)
      strip.position.set(laneCenter, heightAt(z) + 0.045, z)
      strip.receiveShadow = true
      group.add(strip)
    }
  }

  // 分隔带上的松树和岩石，让它看起来真的过不去
  for (const t of [0.36, 0.64]) {
    const z = startZ - t * FORK_LENGTH
    const pine = buildPine(assets, 1.5 + Math.random() * 1.1, true)
    pine.position.set((Math.random() - 0.5) * 1.2, heightAt(z) + 0.45, z)
    pine.rotation.y = Math.random() * Math.PI * 2
    group.add(pine)
  }
  {
    const z = startZ - 0.5 * FORK_LENGTH
    const rock = new THREE.Mesh(assets.rockGeometry, assets.rockMaterial)
    rock.scale.set(0.7, 0.55, 0.65)
    rock.rotation.set(0.4, Math.random() * 3, -0.1)
    rock.position.set((Math.random() - 0.5) * 1.4, heightAt(z) + 0.45, z)
    rock.castShadow = true
    group.add(rock)
  }

  // 岔口不插旗：雪道本来就窄，留给玩家看清楚路

  return group
}

function pickKind(difficulty: number): ObstacleKind {
  const roll = Math.random()
  if (roll < 0.52 - difficulty * 0.1) return 'snowball'
  if (roll < 0.78) return 'rock'
  if (roll < 0.9) return 'log'
  return 'tree'
}

export function buildChunk(
  assets: WorldAssets,
  startZ: number,
  difficulty: number,
  chunkIndex: number,
  /** 靠近岔路时不再插旗，避免雪道拥挤 */
  suppressFlags = false,
): Chunk {
  const group = new THREE.Group()
  group.name = `chunk-${chunkIndex}`

  // 偶尔出现一次 Y 形岔路，避免雪道太乱
  const branch: Branch | null =
    startZ < -200 && (chunkIndex % 10 === 7 || Math.random() < 0.04)
      ? { startZ, endZ: startZ - FORK_LENGTH, divide: FORK_DIVIDE }
      : null

  const { geometry } = buildTerrainGeometry(startZ)
  const terrain = new THREE.Mesh(geometry, assets.terrainMaterial)
  terrain.receiveShadow = true
  group.add(terrain)

  // 雪道两侧堆起的雪堤
  for (const side of [-1, 1]) {
    for (let i = 0; i < 4; i++) {
      const z = startZ - 2 - i * 5.2
      const bank = new THREE.Mesh(assets.sphere, assets.snowSoftMaterial)
      bank.scale.set(2.1 + Math.random() * 0.8, 0.3 + Math.random() * 0.18, 2.5)
      bank.position.set(side * (courseHalfWidthAt(z) + 1.15 + Math.random() * 0.8), heightAt(z) + 0.12, z)
      bank.receiveShadow = true
      group.add(bank)
    }
  }

  // 边界小旗杆：隔一段才插一对，岔路附近不放
  if (!suppressFlags && !branch && chunkIndex % 3 === 0) {
    for (const side of [-1, 1]) {
      const z = startZ - 8
      const edgeX = side * (courseHalfWidthAt(z) + 0.4)
      const pole = new THREE.Mesh(assets.cylinder, assets.darkMaterial)
      pole.scale.set(0.035, 1.35, 0.035)
      pole.position.set(edgeX, heightAt(z) + 0.68, z)
      group.add(pole)
      const flag = new THREE.Mesh(assets.flag, assets.flagMaterials[chunkIndex % assets.flagMaterials.length]!)
      flag.scale.set(0.55, 0.55, 1)
      flag.position.set(edgeX + side * 0.28, heightAt(z) + 1.28, z)
      flag.rotation.y = side > 0 ? Math.PI : 0
      group.add(flag)
    }
  }

  // 两侧松树
  for (const side of [-1, 1]) {
    const count = 2 + Math.floor(Math.random() * 2)
    for (let i = 0; i < count; i++) {
      const z = startZ - 1 - Math.random() * (GAME.chunkLength - 2)
      const x = side * Math.min(courseHalfWidthAt(z) + 2.6 + Math.random() * 5.2, 16.2)
      const pine = buildPine(assets, 2.4 + Math.random() * 3.4, Math.random() > 0.7)
      pine.position.set(x, heightAt(z), z)
      pine.rotation.y = Math.random() * Math.PI * 2
      group.add(pine)

      if (Math.random() > 0.55) {
        const mound = new THREE.Mesh(assets.sphere, assets.snowMaterial)
        mound.scale.set(0.9 + Math.random() * 0.9, 0.25, 0.8)
        mound.position.set(x + (Math.random() - 0.5) * 1.6, heightAt(z) + 0.1, z + (Math.random() - 0.5) * 1.2)
        group.add(mound)
      }
    }
  }

  if (branch) group.add(buildFork(assets, startZ))

  // 障碍物：前 40 米留安全起步区，之后也要稀疏一些，雪道才干净
  const obstacles: Obstacle[] = []
  if (startZ < -40 && Math.random() < 0.34 + difficulty * 0.22) {
    let count = 1
    if (difficulty > 0.55 && Math.random() < 0.2) count = 2
    for (let i = 0; i < count; i++) {
      const z = startZ - 3 - ((i + 0.5) / count) * 16 - Math.random() * 1.5
      const width = courseHalfWidthAt(z)
      let x = (Math.random() * 2 - 1) * Math.min(width - 1.3, 7.6)
      // 岔路里让出中间的分隔带，障碍只摆到两条车道里
      if (branch) {
        const divide = Math.min(FORK_DIVIDE, width * 0.42) + 0.9
        if (Math.abs(x) < divide) x = (x >= 0 ? 1 : -1) * (divide + 0.9 + Math.random() * 2)
      }
      if (obstacles.some(item => Math.abs(item.z - z) < 5 && Math.abs(item.x - x) < 2.4)) {
        x = x > 0 ? x - 2.6 : x + 2.6
      }
      const kind = pickKind(difficulty)
      const config = OBSTACLE_CONFIG[kind]
      const obstacleGroup = buildObstacle(assets, kind)
      obstacleGroup.position.set(x, heightAt(z), z)
      obstacleGroup.rotation.y = Math.random() * Math.PI * 2
      group.add(obstacleGroup)
      obstacles.push({ kind, x, z, radius: config.radius, group: obstacleGroup, active: true })
    }
  }

  // 空中奖励：一串发光道具，得跳起来才能吃到（约每 80 米一串，不会太密）
  const pickups: Pickup[] = []
  if (startZ < -55 && chunkIndex % 4 === 2 && Math.random() < 0.75) {
    const trail = { total: 4, got: 0 }
    const roll = Math.random()
    const kind: PickupKind =
      roll < 0.34 ? 'bread' : roll < 0.6 ? 'icecream' : roll < 0.78 ? 'snowflake' : roll < 0.94 ? 'diamond' : 'shield'
    const baseZ = startZ - 3 - Math.random() * 6
    const baseX = (Math.random() * 2 - 1) * 3.4
    const drift = (Math.random() * 2 - 1) * 1.3
    for (let i = 0; i < trail.total; i++) {
      const z = baseZ - i * 4.2
      const width = courseHalfWidthAt(z)
      const x = THREE.MathUtils.clamp(baseX + drift * i, -(width - 1.4), width - 1.4)
      const y = heightAt(z) + 2.15
      const item = buildPickup(assets, kind)
      item.position.set(x, y, z)
      item.rotation.y = Math.random() * Math.PI * 2
      group.add(item)
      pickups.push({
        kind,
        x,
        y,
        z,
        group: item,
        taken: false,
        phase: Math.random() * Math.PI * 2,
        trail,
      })
    }
  }

  // 空中危险物：约每 100 米一小撮，且避开岔路
  const hazards: Hazard[] = []
  if (startZ < -130 && !branch && chunkIndex % 5 === 3 && Math.random() < 0.85) {
    const count = 2 + Math.floor(Math.random() * 2)
    const baseZ = startZ - 4 - Math.random() * 8
    const baseX = (Math.random() * 2 - 1) * 3.6
    const drift = (Math.random() * 2 - 1) * 1.8
    const kinds: HazardKind[] = ['scissors', 'icicle', 'rock']
    for (let i = 0; i < count; i++) {
      const z = baseZ - i * 4.6
      const width = courseHalfWidthAt(z)
      const x = THREE.MathUtils.clamp(baseX + drift * i, -(width - 1.3), width - 1.3)
      const y = heightAt(z) + 1.25 + Math.random() * 0.45
      const kind = kinds[Math.floor(Math.random() * kinds.length)]!
      const item = buildHazard(assets, kind)
      item.position.set(x, y, z)
      item.rotation.y = Math.random() * Math.PI * 2
      group.add(item)
      hazards.push({ kind, x, y, z, group: item, active: true, phase: Math.random() * Math.PI * 2 })
    }
  }

  // 观众：偶尔出现一小撮，站在雪道边；第一段固定有一组，保证玩家能遇到
  const spectators: Spectator[] = []
  if (startZ < -15 && (chunkIndex === 2 || Math.random() < 0.45)) {
    const side = Math.random() > 0.5 ? 1 : -1
    const crowd = 2 + Math.floor(Math.random() * 3)
    const baseZ = startZ - 5 - Math.random() * 9
    for (let i = 0; i < crowd; i++) {
      const z = baseZ - i * 1.15 + (Math.random() - 0.5) * 0.5
      const x = side * (courseHalfWidthAt(z) + 2.3 + Math.random() * 2.2) + (Math.random() - 0.5) * 1.8
      const spectator = buildSpectator(assets, x, z, side, chunkIndex * 5 + i)
      group.add(spectator.group)
      spectators.push(spectator)
    }

    const bannerZ = baseZ - 0.3
    const bannerX = side * (courseHalfWidthAt(bannerZ) + 3.3)
    const banner = new THREE.Mesh(assets.banner, assets.cheerMaterial)
    banner.position.set(bannerX, heightAt(bannerZ) + 2.55, bannerZ)
    group.add(banner)
    for (const poleSide of [-1, 1]) {
      const pole = new THREE.Mesh(assets.cylinder, assets.darkMaterial)
      pole.scale.set(0.035, 3, 0.035)
      pole.position.set(bannerX + poleSide * 1.3, heightAt(bannerZ) + 1.5, bannerZ)
      group.add(pole)
    }
  }

  // 偶尔来一间亮着暖灯的雪场小木屋
  if (startZ < -40 && Math.random() < 0.1) {
    const side = Math.random() > 0.5 ? 1 : -1
    const cabin = buildCabin(assets, side * (13.6 + Math.random() * 1.2), startZ - 10 - Math.random() * 6)
    group.add(cabin)
  }

  if (startZ === 0) {
    group.add(buildStartGate(assets))
  }

  return { startZ, group, obstacles, spectators, pickups, hazards, terrainGeometry: geometry, branch }
}

export function disposeChunk(chunk: Chunk): void {
  chunk.group.removeFromParent()
  chunk.group.clear()
  chunk.terrainGeometry.dispose()
}
