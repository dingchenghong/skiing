import * as THREE from 'three'
import { heightAt } from './terrain'

/** 偶尔冲上雪道乱撞的失控卡车 */
export class Truck {
  readonly group = new THREE.Group()
  x: number
  z: number
  private readonly vx: number
  private readonly vz: number
  private readonly materials: THREE.Material[] = []
  private readonly geometries: THREE.BufferGeometry[] = []

  constructor(x: number, z: number, direction: number) {
    this.x = x
    this.z = z
    this.vx = direction * (7.5 + Math.random() * 3.5)
    this.vz = -5.5

    this.group.name = 'truck'

    const bodyMat = this.material('#f0a53a', { roughness: 0.55, metalness: 0.35 })
    const cargoMat = this.material('#e8eef5', { roughness: 0.6, metalness: 0.25 })
    const darkMat = this.material('#1d2733', { roughness: 0.7, metalness: 0.2 })
    const glassMat = this.material('#8fd0e8', {
      roughness: 0.15,
      metalness: 0.6,
      emissive: '#2a6f8c',
      emissiveIntensity: 0.7,
    })
    const lightMat = this.material('#fff2c0', {
      roughness: 0.2,
      emissive: '#ffd166',
      emissiveIntensity: 2,
    })

    // 车头 / 车厢
    this.box(bodyMat, [1.95, 1.5, 1.9], [0, 1.95, -1.5])
    this.box(cargoMat, [2.0, 1.9, 3.0], [0, 2.2, 0.9])
    this.box(darkMat, [2.05, 0.5, 5.3], [0, 1.02, 0])

    // 挡风玻璃与侧窗
    this.box(glassMat, [1.66, 0.62, 0.1], [0, 2.18, -2.47])
    this.box(glassMat, [0.08, 0.5, 0.9], [0.99, 2.14, -1.5])
    this.box(glassMat, [0.08, 0.5, 0.9], [-0.99, 2.14, -1.5])

    // 保险杠与车灯
    this.box(darkMat, [2.1, 0.3, 0.3], [0, 0.72, -2.62])
    this.sphere(lightMat, 0.16, [0.62, 1.08, -2.6])
    this.sphere(lightMat, 0.16, [-0.62, 1.08, -2.6])

    // 车轮
    for (const side of [-1, 1]) {
      for (const wheelZ of [-1.7, 0.9, 2.0]) {
        const wheel = this.mesh(new THREE.CylinderGeometry(0.46, 0.46, 0.34, 10), darkMat)
        wheel.rotation.z = Math.PI / 2
        wheel.position.set(side * 0.98, 0.46, wheelZ)
        this.group.add(wheel)
      }
    }

    // 车顶警示灯
    this.box(darkMat, [1.1, 0.12, 0.24], [0, 2.9, -1.5])
    this.sphere(lightMat, 0.13, [0.42, 3.0, -1.5])
    this.sphere(lightMat, 0.13, [-0.42, 3.0, -1.5])

    this.group.position.set(x, heightAt(z), z)
    this.group.rotation.y = Math.atan2(-this.vx, -this.vz)
  }

  update(dt: number): void {
    this.x += this.vx * dt
    this.z += this.vz * dt
    this.group.position.set(this.x, heightAt(this.z), this.z)
    this.group.rotation.y = Math.atan2(-this.vx, -this.vz)
    this.group.rotation.z = Math.sin(this.z * 0.3) * 0.05
  }

  /** 冲出雪道就收工 */
  get gone(): boolean {
    return Math.abs(this.x) > 17
  }

  dispose(): void {
    this.group.removeFromParent()
    this.group.clear()
    this.geometries.forEach(geometry => geometry.dispose())
    this.materials.forEach(material => material.dispose())
  }

  private material(color: string, extra: Partial<THREE.MeshStandardMaterialParameters> = {}) {
    const material = new THREE.MeshStandardMaterial({ color, ...extra })
    this.materials.push(material)
    return material
  }

  private mesh(geometry: THREE.BufferGeometry, material: THREE.Material): THREE.Mesh {
    this.geometries.push(geometry)
    const mesh = new THREE.Mesh(geometry, material)
    mesh.castShadow = true
    return mesh
  }

  private box(material: THREE.Material, size: [number, number, number], position: [number, number, number]) {
    const mesh = this.mesh(new THREE.BoxGeometry(size[0], size[1], size[2]), material)
    mesh.position.set(position[0], position[1], position[2])
    this.group.add(mesh)
  }

  private sphere(material: THREE.Material, radius: number, position: [number, number, number]) {
    const mesh = this.mesh(new THREE.SphereGeometry(radius, 10, 8), material)
    mesh.position.set(position[0], position[1], position[2])
    this.group.add(mesh)
  }
}
