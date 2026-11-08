import * as THREE from 'three'
import { GAME, type JacketOption } from './data'
import { heightAt, slopeAngleAt } from './terrain'
import { Skier, type SkierPose } from './skier'

/**
 * 赛道上的其他滑雪者。
 *
 * 他们会顺着雪道往下滑，一旦和你并排就会朝你的方向靠过来，
 * 撞到就会掉体力、扣分。
 */
export class Rival {
  readonly skier: Skier
  readonly group: THREE.Group
  readonly jacket: JacketOption
  x: number
  z: number
  speed: number
  hitCooldown = 0
  private time = 0
  private lateral = 0
  private readonly offset: number

  constructor(jacket: JacketOption, x: number, z: number, speed: number) {
    this.jacket = jacket
    this.skier = new Skier(jacket)
    this.group = this.skier.group
    this.group.name = 'rival'
    this.x = x
    this.z = z
    this.speed = speed
    this.offset = (Math.random() - 0.5) * 1.8
    this.group.position.set(x, heightAt(z), z)
    this.skier.update(0.016, this.pose())
  }

  update(dt: number, playerX: number, playerZ: number, playerSpeed: number): void {
    this.time += dt
    if (this.hitCooldown > 0) this.hitCooldown = Math.max(0, this.hitCooldown - dt)

    const gap = this.z - playerZ // 负值表示对手在玩家前方
    const near = gap > -70 && gap < 30
    const targetX = near ? playerX + this.offset : this.x
    const desired = THREE.MathUtils.clamp(
      (targetX - this.x) * 1.7,
      -GAME.steerSpeed,
      GAME.steerSpeed,
    )
    this.lateral += (desired - this.lateral) * Math.min(1, dt * 2.6)
    this.x = THREE.MathUtils.clamp(this.x + this.lateral * dt, -11, 11)

    // 始终比玩家慢一点，保证能追上并发生碰撞
    const pace = THREE.MathUtils.clamp(playerSpeed * (near ? 0.68 : 0.6), 5, 17)
    this.speed += (pace - this.speed) * Math.min(1, dt * 1.25)

    this.z -= this.speed * Math.cos(slopeAngleAt(this.z)) * dt
    this.group.position.set(this.x, heightAt(this.z), this.z)
    this.skier.update(dt, this.pose())
  }

  /** 被撞开后向反方向弹出去 */
  knock(direction: number): void {
    this.lateral = -direction * 4.5
    this.speed *= 0.6
    this.hitCooldown = 2.6
  }

  dispose(): void {
    this.skier.dispose()
  }

  private pose(): SkierPose {
    return {
      pitch: -slopeAngleAt(this.z) * 0.9 - 0.1,
      yaw: -this.lateral * 0.05,
      lean: -this.lateral * 0.045,
      speed: this.speed,
      steering: THREE.MathUtils.clamp(this.lateral / GAME.steerSpeed, -1, 1),
      braking: false,
      time: this.time,
      airborne: false,
      airHeight: 0,
    }
  }
}
