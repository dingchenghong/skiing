import { describe, expect, it } from 'vitest'
import { heightAt, slopeAt } from '../game/terrain'
import { ATTACK_CONFIG, BOMB_CONFIG, GAME, JACKETS, OBSTACLE_CONFIG, RIVAL_CONFIG, jacketById } from '../game/data'

describe('雪道高度函数', () => {
  it('沿下滑方向持续降低', () => {
    let previous = heightAt(0)
    for (let z = -2; z >= -2000; z -= 8) {
      const next = heightAt(z)
      expect(next).toBeLessThan(previous)
      previous = next
    }
  })

  it('坡度保持在可滑行的范围内', () => {
    for (let z = 0; z >= -3000; z -= 5) {
      const slope = slopeAt(z)
      expect(slope).toBeGreaterThan(0.08)
      expect(slope).toBeLessThan(0.42)
    }
  })
})

describe('滑雪配置', () => {
  it('提供六种衣服颜色且数量稳定', () => {
    expect(JACKETS).toHaveLength(6)
    expect(new Set(JACKETS.map(item => item.id)).size).toBe(6)
  })

  it('颜色 id 不存在时回退到第一套', () => {
    expect(jacketById('missing').id).toBe(JACKETS[0]!.id)
  })

  it('所有障碍都会造成扣分和体力损失', () => {
    Object.values(OBSTACLE_CONFIG).forEach(config => {
      expect(config.penalty).toBeGreaterThan(0)
      expect(config.health).toBeGreaterThan(0)
      expect(config.radius).toBeGreaterThan(0)
      expect(config.clearance).toBeGreaterThan(0)
    })
  })

  it('跳跃高度足以越过小雪团和倒木', () => {
    const jumpHeight = (GAME.jumpVelocity * GAME.jumpVelocity) / (2 * GAME.jumpGravity)
    expect(jumpHeight).toBeGreaterThan(OBSTACLE_CONFIG.snowball.clearance)
    expect(jumpHeight).toBeGreaterThan(OBSTACLE_CONFIG.log.clearance)
    expect(jumpHeight).toBeGreaterThan(2.5)
  })
})

describe('动作系统配置', () => {
  it('挥杆和飞踢都有冷却、判定范围与得分', () => {
    Object.values(ATTACK_CONFIG).forEach(config => {
      expect(config.cooldown).toBeGreaterThan(0)
      expect(config.duration).toBeGreaterThan(0)
      expect(config.range).toBeGreaterThan(1)
      expect(config.reach).toBeGreaterThan(1)
      expect(config.bonus).toBeGreaterThan(0)
      expect(config.damage).toBeGreaterThan(0)
    })
  })

  it('两下挥杆能打倒一个对手，爆弹一发就能炸翻', () => {
    expect(ATTACK_CONFIG.punch.damage * 2).toBeGreaterThanOrEqual(RIVAL_CONFIG.maxHealth)
    expect(ATTACK_CONFIG.kick.damage * 2).toBeGreaterThanOrEqual(RIVAL_CONFIG.maxHealth)
    expect(BOMB_CONFIG.damage).toBeGreaterThanOrEqual(RIVAL_CONFIG.maxHealth)
  })

  it('对手主动出手的距离不超过玩家踢腿的判定范围', () => {
    expect(RIVAL_CONFIG.attackRange).toBeLessThanOrEqual(ATTACK_CONFIG.kick.reach)
  })

  it('爆弹的爆炸范围大于引爆范围，且冷却长于存留时间', () => {
    expect(BOMB_CONFIG.radius).toBeGreaterThan(BOMB_CONFIG.triggerRadius)
    expect(BOMB_CONFIG.cooldown).toBeGreaterThan(BOMB_CONFIG.life)
    expect(BOMB_CONFIG.bonus).toBeGreaterThan(0)
  })
})
