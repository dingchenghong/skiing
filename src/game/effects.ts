import * as THREE from 'three'

function makeSnowTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 32
  canvas.height = 32
  const ctx = canvas.getContext('2d')
  if (ctx) {
    const gradient = ctx.createRadialGradient(16, 16, 0, 16, 16, 16)
    gradient.addColorStop(0, 'rgba(255,255,255,1)')
    gradient.addColorStop(0.4, 'rgba(255,255,255,0.9)')
    gradient.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = gradient
    ctx.fillRect(0, 0, 32, 32)
  }
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}

interface SnowLayer {
  points: THREE.Points
  positions: THREE.BufferAttribute
  speeds: Float32Array
  spread: number
  height: number
}

/** 围绕镜头下落的雪，保证任何速度下都能看到雪 */
export class Snowfall {
  readonly group = new THREE.Group()
  private texture: THREE.CanvasTexture
  private layers: SnowLayer[] = []
  private time = 0

  constructor(scene: THREE.Scene) {
    this.group.name = 'snowfall'
    scene.add(this.group)
    this.texture = makeSnowTexture()

    this.addLayer(920, 34, 18, 0.16, 0.8, 1.2, 2.9)
    this.addLayer(170, 18, 12, 0.34, 0.62, 2.1, 3.8)
  }

  private addLayer(
    count: number,
    spread: number,
    height: number,
    size: number,
    opacity: number,
    minSpeed: number,
    maxSpeed: number,
  ): void {
    const positions = new Float32Array(count * 3)
    const speeds = new Float32Array(count)
    for (let i = 0; i < count; i++) {
      positions[i * 3] = (Math.random() - 0.5) * spread * 2
      positions[i * 3 + 1] = (Math.random() - 0.5) * height * 2
      positions[i * 3 + 2] = (Math.random() - 0.5) * spread * 2
      speeds[i] = minSpeed + Math.random() * (maxSpeed - minSpeed)
    }
    const geometry = new THREE.BufferGeometry()
    const attribute = new THREE.BufferAttribute(positions, 3)
    geometry.setAttribute('position', attribute)
    const material = new THREE.PointsMaterial({
      color: '#ffffff',
      map: this.texture,
      size,
      transparent: true,
      opacity,
      depthWrite: false,
      sizeAttenuation: true,
      alphaTest: 0.01,
    })
    const points = new THREE.Points(geometry, material)
    points.frustumCulled = false
    this.group.add(points)
    this.layers.push({ points, positions: attribute, speeds, spread, height })
  }

  update(dt: number, camera: THREE.Camera): void {
    this.time += dt
    this.group.position.copy(camera.position)
    for (const layer of this.layers) {
      const positions = layer.positions.array as Float32Array
      for (let i = 0; i < layer.speeds.length; i++) {
        const xIndex = i * 3
        const yIndex = xIndex + 1
        const zIndex = xIndex + 2
        positions[yIndex] = (positions[yIndex] ?? 0) - (layer.speeds[i] ?? 1.5) * dt
        positions[xIndex] = (positions[xIndex] ?? 0) + (0.45 + Math.sin(this.time * 0.6 + i) * 0.2) * dt
        positions[zIndex] = (positions[zIndex] ?? 0) + 0.18 * dt
        if ((positions[yIndex] ?? 0) < -layer.height) {
          positions[yIndex] = layer.height
          positions[xIndex] = (Math.random() - 0.5) * layer.spread * 2
          positions[zIndex] = (Math.random() - 0.5) * layer.spread * 2
        }
        if ((positions[xIndex] ?? 0) > layer.spread) positions[xIndex] = -layer.spread
        if ((positions[zIndex] ?? 0) > layer.spread) positions[zIndex] = -layer.spread
      }
      layer.positions.needsUpdate = true
    }
  }

  dispose(): void {
    this.layers.forEach(layer => {
      layer.points.geometry.dispose()
      const material = layer.points.material
      if (Array.isArray(material)) material.forEach(item => item.dispose())
      else material.dispose()
    })
    this.texture.dispose()
    this.group.removeFromParent()
    this.layers = []
  }
}

interface SprayParticle {
  mesh: THREE.Mesh
  material: THREE.MeshBasicMaterial
  velocity: THREE.Vector3
  life: number
  maxLife: number
  size: number
}

/** 雪板带起的雪雾，以及撞上雪团时的雪爆 */
export class SnowSpray {
  readonly group = new THREE.Group()
  private geometry: THREE.SphereGeometry
  private pool: SprayParticle[] = []
  private active = 0

  constructor(scene: THREE.Scene) {
    this.group.name = 'snow-spray'
    scene.add(this.group)
    this.geometry = new THREE.SphereGeometry(1, 7, 5)
    for (let i = 0; i < 90; i++) {
      const material = new THREE.MeshBasicMaterial({
        color: '#f4fbff',
        transparent: true,
        opacity: 0,
        depthWrite: false,
      })
      const mesh = new THREE.Mesh(this.geometry, material)
      mesh.visible = false
      mesh.renderOrder = 2
      this.group.add(mesh)
      this.pool.push({ mesh, material, velocity: new THREE.Vector3(), life: 0, maxLife: 1, size: 0.1 })
    }
  }

  private take(): SprayParticle | null {
    for (let i = 0; i < this.pool.length; i++) {
      const index = (this.active + i) % this.pool.length
      const particle = this.pool[index]
      if (particle && !particle.mesh.visible) {
        this.active = (index + 1) % this.pool.length
        return particle
      }
    }
    return null
  }

  spray(x: number, y: number, z: number, amount: number, lateral: number, speed: number): void {
    for (let i = 0; i < amount; i++) {
      const particle = this.take()
      if (!particle) return
      const side = i % 2 === 0 ? -1 : 1
      particle.mesh.position.set(x + side * 0.34, y + 0.08, z + 0.15)
      particle.mesh.visible = true
      particle.size = 0.055 + Math.random() * 0.07
      particle.mesh.scale.setScalar(particle.size)
      particle.life = 0.35 + Math.random() * 0.35
      particle.maxLife = particle.life
      particle.velocity.set(
        lateral * 0.32 + (Math.random() - 0.5) * 1.8,
        0.8 + Math.random() * 1.6,
        1.2 + speed * 0.09 + Math.random() * 1.2,
      )
      particle.material.opacity = 0.75
    }
  }

  burst(x: number, y: number, z: number, amount = 18): void {
    for (let i = 0; i < amount; i++) {
      const particle = this.take()
      if (!particle) return
      particle.mesh.position.set(x + (Math.random() - 0.5) * 0.8, y + 0.3 + Math.random() * 0.4, z + (Math.random() - 0.5) * 0.8)
      particle.mesh.visible = true
      particle.size = 0.08 + Math.random() * 0.16
      particle.mesh.scale.setScalar(particle.size)
      particle.life = 0.55 + Math.random() * 0.5
      particle.maxLife = particle.life
      const angle = Math.random() * Math.PI * 2
      const force = 1.8 + Math.random() * 3.2
      particle.velocity.set(Math.cos(angle) * force, 1.4 + Math.random() * 2.8, Math.sin(angle) * force)
      particle.material.opacity = 0.92
    }
  }

  clear(): void {
    this.pool.forEach(particle => {
      particle.mesh.visible = false
      particle.material.opacity = 0
      particle.life = 0
    })
  }

  update(dt: number): void {
    for (const particle of this.pool) {
      if (!particle.mesh.visible) continue
      particle.life -= dt
      if (particle.life <= 0) {
        particle.mesh.visible = false
        particle.material.opacity = 0
        continue
      }
      const progress = 1 - particle.life / particle.maxLife
      particle.velocity.y -= 6.2 * dt
      particle.mesh.position.addScaledVector(particle.velocity, dt)
      particle.mesh.scale.setScalar(particle.size * (1.4 + progress * 2.1))
      particle.material.opacity = 0.8 * (1 - progress * progress)
    }
  }

  dispose(): void {
    this.pool.forEach(particle => particle.material.dispose())
    this.geometry.dispose()
    this.group.removeFromParent()
    this.pool = []
  }
}

/** 玩家丢下的爆弹：黑色小球 + 冒火花的引线 */
export class Bomb {
  readonly group = new THREE.Group()
  readonly x: number
  readonly y: number
  readonly z: number
  private readonly spark: THREE.Mesh
  private readonly materials: THREE.Material[] = []
  private readonly life: number
  private elapsed = 0

  constructor(x: number, y: number, z: number, life = 2.4) {
    this.x = x
    this.y = y
    this.z = z
    this.life = Math.max(0.4, life)
    this.group.name = 'bomb'
    this.group.position.set(x, y, z)

    const shell = new THREE.MeshStandardMaterial({ color: '#141c26', roughness: 0.42, metalness: 0.55 })
    const band = new THREE.MeshStandardMaterial({
      color: '#ff8a3d',
      roughness: 0.4,
      metalness: 0.3,
      emissive: '#ff5a1f',
      emissiveIntensity: 0.45,
    })
    const sparkMaterial = new THREE.MeshBasicMaterial({ color: '#ffe9a8' })
    this.materials.push(shell, band, sparkMaterial)

    const body = new THREE.Mesh(new THREE.SphereGeometry(0.26, 10, 8), shell)
    body.castShadow = true
    this.group.add(body)

    const stripe = new THREE.Mesh(new THREE.TorusGeometry(0.24, 0.028, 6, 14), band)
    stripe.rotation.x = Math.PI / 2
    this.group.add(stripe)

    const fuse = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, 0.18, 6), band)
    fuse.position.set(0.03, 0.34, 0)
    fuse.rotation.z = 0.2
    this.group.add(fuse)

    this.spark = new THREE.Mesh(new THREE.SphereGeometry(0.07, 6, 5), sparkMaterial)
    this.spark.position.set(0.06, 0.44, 0)
    this.group.add(this.spark)
  }

  get elapsedTime(): number {
    return this.elapsed
  }

  get expired(): boolean {
    return this.elapsed >= this.life
  }

  update(dt: number): void {
    this.elapsed += dt
    this.group.rotation.y += dt * 2.1
    // 越接近爆炸，火花闪得越急
    const rate = 18 + (this.elapsed / this.life) * 26
    this.spark.visible = Math.sin(this.elapsed * rate) > -0.15
    this.spark.scale.setScalar(0.7 + Math.random() * 0.6)
  }

  dispose(): void {
    this.group.traverse(object => {
      const mesh = object as THREE.Mesh
      mesh.geometry?.dispose()
    })
    this.materials.forEach(material => material.dispose())
    this.materials.length = 0
    this.group.removeFromParent()
  }
}

/** 爆弹爆炸：一团快速扩散的火球 + 贴地的冲击环 */
export class Blast {
  readonly group = new THREE.Group()
  private readonly fire: THREE.Mesh
  private readonly ring: THREE.Mesh
  private readonly fireMaterial: THREE.MeshBasicMaterial
  private readonly ringMaterial: THREE.MeshBasicMaterial
  private readonly size: number
  private readonly life = 0.6
  private elapsed = 0

  constructor(x: number, y: number, z: number, radius: number) {
    this.size = radius
    this.group.name = 'blast'
    this.group.position.set(x, y + 0.4, z)

    this.fireMaterial = new THREE.MeshBasicMaterial({
      color: '#ffb054',
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    })
    this.ringMaterial = new THREE.MeshBasicMaterial({
      color: '#fff2c9',
      transparent: true,
      opacity: 0.8,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    })

    this.fire = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 8), this.fireMaterial)
    this.fire.renderOrder = 3
    this.group.add(this.fire)

    this.ring = new THREE.Mesh(new THREE.TorusGeometry(1, 0.06, 6, 22), this.ringMaterial)
    this.ring.rotation.x = -Math.PI / 2
    this.ring.renderOrder = 3
    this.group.add(this.ring)
  }

  /** 返回 false 表示爆炸已经放完 */
  update(dt: number): boolean {
    this.elapsed += dt
    const k = Math.min(1, this.elapsed / this.life)
    const ease = 1 - Math.pow(1 - k, 3)
    this.fire.scale.setScalar(this.size * (0.18 + ease * 0.5))
    this.fireMaterial.opacity = (1 - k) * 0.85
    this.ring.scale.setScalar(this.size * (0.25 + ease * 0.9))
    this.ringMaterial.opacity = (1 - k) * 0.75
    return k < 1
  }

  dispose(): void {
    this.fire.geometry.dispose()
    this.ring.geometry.dispose()
    this.fireMaterial.dispose()
    this.ringMaterial.dispose()
    this.group.removeFromParent()
  }
}

/* ---------- 命中特效：星芒闪光 + 冲击环 + 四散的碎光 ---------- */

let starTexture: THREE.CanvasTexture | null = null
let shockRingTexture: THREE.CanvasTexture | null = null
let shardGeometry: THREE.OctahedronGeometry | null = null

/** 命中点的十字星芒，程序化生成一次后复用 */
function getStarTexture(): THREE.CanvasTexture {
  if (starTexture) return starTexture
  const canvas = document.createElement('canvas')
  canvas.width = 96
  canvas.height = 96
  const ctx = canvas.getContext('2d')
  if (ctx) {
    const glow = ctx.createRadialGradient(48, 48, 0, 48, 48, 48)
    glow.addColorStop(0, 'rgba(255,255,255,1)')
    glow.addColorStop(0.18, 'rgba(255,255,255,0.9)')
    glow.addColorStop(0.46, 'rgba(255,255,255,0.22)')
    glow.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = glow
    ctx.fillRect(0, 0, 96, 96)

    ctx.translate(48, 48)
    ctx.fillStyle = 'rgba(255,255,255,0.85)'
    for (let i = 0; i < 4; i++) {
      ctx.beginPath()
      ctx.moveTo(0, -46)
      ctx.lineTo(3.2, -14)
      ctx.lineTo(0, 0)
      ctx.lineTo(-3.2, -14)
      ctx.closePath()
      ctx.fill()
      ctx.rotate(Math.PI / 2)
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0)
  }
  starTexture = new THREE.CanvasTexture(canvas)
  starTexture.colorSpace = THREE.SRGBColorSpace
  return starTexture
}

/** 冲击波圆环贴图 */
function getShockRingTexture(): THREE.CanvasTexture {
  if (shockRingTexture) return shockRingTexture
  const canvas = document.createElement('canvas')
  canvas.width = 128
  canvas.height = 128
  const ctx = canvas.getContext('2d')
  if (ctx) {
    const ring = ctx.createRadialGradient(64, 64, 30, 64, 64, 63)
    ring.addColorStop(0, 'rgba(255,255,255,0)')
    ring.addColorStop(0.7, 'rgba(255,255,255,0.95)')
    ring.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = ring
    ctx.beginPath()
    ctx.arc(64, 64, 63, 0, Math.PI * 2)
    ctx.fill()
  }
  shockRingTexture = new THREE.CanvasTexture(canvas)
  shockRingTexture.colorSpace = THREE.SRGBColorSpace
  return shockRingTexture
}

interface ShardParticle {
  mesh: THREE.Mesh
  material: THREE.MeshBasicMaterial
  velocity: THREE.Vector3
  spin: THREE.Vector3
}

/**
 * 打中 / 踢中对手时的命中特效。
 * 一团十字星芒闪一下 + 一圈冲击波向外扩散 + 几块碎光飞散，
 * 颜色可以按招式调整，和爆炸的火球区分开。
 */
export class Impact {
  readonly group = new THREE.Group()
  private readonly flash: THREE.Sprite
  private readonly ring: THREE.Sprite
  private readonly flashMaterial: THREE.SpriteMaterial
  private readonly ringMaterial: THREE.SpriteMaterial
  private readonly shards: ShardParticle[] = []
  private readonly geometry: THREE.OctahedronGeometry
  private readonly scaleFactor: number
  private readonly life = 0.45
  private elapsed = 0

  constructor(x: number, y: number, z: number, color = '#fff4cf', scale = 1) {
    this.scaleFactor = scale
    this.group.name = 'impact'
    this.group.position.set(x, y, z)

    this.flashMaterial = new THREE.SpriteMaterial({
      map: getStarTexture(),
      color,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending,
    })
    this.flash = new THREE.Sprite(this.flashMaterial)
    this.flash.scale.setScalar(1.5 * scale)
    this.flash.renderOrder = 6
    this.group.add(this.flash)

    this.ringMaterial = new THREE.SpriteMaterial({
      map: getShockRingTexture(),
      color,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending,
    })
    this.ring = new THREE.Sprite(this.ringMaterial)
    this.ring.scale.setScalar(1.1 * scale)
    this.ring.renderOrder = 5
    this.group.add(this.ring)

    this.geometry = shardGeometry ?? new THREE.OctahedronGeometry(0.045, 0)
    shardGeometry = this.geometry
    for (let i = 0; i < 7; i++) {
      const material = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 1,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      })
      const mesh = new THREE.Mesh(this.geometry, material)
      mesh.renderOrder = 5
      this.group.add(mesh)
      const angle = Math.random() * Math.PI * 2
      const speed = 2.4 + Math.random() * 2.6
      this.shards.push({
        mesh,
        material,
        velocity: new THREE.Vector3(Math.cos(angle) * speed, 0.9 + Math.random() * 1.8, Math.sin(angle) * speed * 0.7),
        spin: new THREE.Vector3(Math.random() * 12, Math.random() * 12, Math.random() * 12),
      })
    }
  }

  /** 返回 false 表示特效已经放完 */
  update(dt: number): boolean {
    this.elapsed += dt
    const k = Math.min(1, this.elapsed / this.life)
    this.flash.scale.setScalar((0.8 + k * 1.5) * this.scaleFactor)
    this.flashMaterial.opacity = Math.max(0, 1 - k * 1.8)
    this.ring.scale.setScalar((0.4 + k * 1.9) * this.scaleFactor)
    this.ringMaterial.opacity = Math.max(0, 0.9 - k * 1.4)

    for (const shard of this.shards) {
      shard.velocity.y -= 7 * dt
      shard.mesh.position.addScaledVector(shard.velocity, dt)
      shard.mesh.rotation.x += shard.spin.x * dt
      shard.mesh.rotation.y += shard.spin.y * dt
      shard.mesh.rotation.z += shard.spin.z * dt
      shard.material.opacity = Math.max(0, 1 - k * 1.2)
      shard.mesh.scale.setScalar(1 - k * 0.5)
    }
    return k < 1
  }

  dispose(): void {
    this.flashMaterial.dispose()
    this.ringMaterial.dispose()
    this.shards.forEach(shard => shard.material.dispose())
    this.group.removeFromParent()
  }
}
