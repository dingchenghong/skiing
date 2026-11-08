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
