import { describe, expect, it } from 'vitest'
import { heightAt, slopeAt } from '../game/terrain'
import { GAME, JACKETS, OBSTACLE_CONFIG, jacketById } from '../game/data'

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
