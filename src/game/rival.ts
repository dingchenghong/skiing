import * as THREE from 'three'
import { GAME, RIVAL_CONFIG, type JacketOption } from './data'
import { heightAt, slopeAngleAt } from './terrain'
import { Skier, type SkierAction, type SkierPose } from './skier'

/**
 * 赛道上的其他滑雪者。
 *
 * 他们会顺着雪道往下滑，靠近玩家后会主动出手（挥杆或飞踢）。
 * 玩家打中他们会掉血、被击退，血量清零就会被撞翻。
 */
export class Rival {
  readonly skier: Skier
  readonly group: THREE.Group
  readonly jacket: JacketOption
  x: number
  z: number
  speed: number
  /** 挨打后的硬直：这期间不会还手，碰撞也不会伤到玩家 */
  stun = 0
  /** 挨打后的保护时间，避免连续被同一招刷分 */
  hurtCooldown = 0
  /** 自己出手的冷却 */
  attackCooldown = 0
  health = RIVAL_CONFIG.maxHealth
  knockedOut = false
  private downTime = 0
  private time = 0
  private lateral = 0
  private readonly offset: number
  private attackKind: SkierAction | null = null
  private attackTimer = 0
  private attackDuration = 0
  private attackSide = 1

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

  get gone(): boolean {
    return this.knockedOut && this.downTime > 1.5
  }

  update(dt: number, playerX: number, playerZ: number, playerSpeed: number): void {
    this.time += dt
    if (this.stun > 0) this.stun = Math.max(0, this.stun - dt)
    if (this.hurtCooldown > 0) this.hurtCooldown = Math.max(0, this.hurtCooldown - dt)
    if (this.attackCooldown > 0) this.attackCooldown = Math.max(0, this.attackCooldown - dt)
    if (this.attackTimer > 0) {
      this.attackTimer = Math.max(0, this.attackTimer - dt)
      if (this.attackTimer === 0) this.attackKind = null
    }

    if (this.knockedOut) {
      // 被撞翻后一路滑出去，逐渐陷进雪里
      this.downTime += dt
      this.speed = Math.max(0, this.speed - 8 * dt)
      this.z -= this.speed * Math.cos(slopeAngleAt(this.z)) * dt
      this.group.position.set(this.x, heightAt(this.z) - Math.min(0.35, this.downTime * 0.5), this.z)
      this.skier.update(dt, this.pose())
      return
    }

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

  /** 主动向玩家出手，side 表示玩家在自己哪一侧 */
  attack(kind: 'punch' | 'kick', side: number): void {
    this.attackKind = kind
    this.attackDuration = kind === 'punch' ? 0.5 : 0.58
    this.attackTimer = this.attackDuration
    this.attackSide = side
    this.attackCooldown = RIVAL_CONFIG.attackInterval
  }

  /** 受到伤害，返回是否被击倒 */
  damage(amount: number): boolean {
    if (this.knockedOut) return false
    this.health = Math.max(0, this.health - amount)
    if (this.health > 0) return false
    this.knockedOut = true
    this.downTime = 0
    this.skier.crash()
    this.speed *= 0.35
    return true
  }

  /** 被撞开后向反方向弹出去 */
  knock(direction: number): void {
    this.lateral = -direction * 4.5
    this.speed *= 0.85
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
      action: this.attackKind,
      actionProgress:
        this.attackKind && this.attackDuration > 0 ? 1 - this.attackTimer / this.attackDuration : 0,
      actionSide: this.attackSide,
    }
  }
}
