/**
 * 雪道高度函数。
 *
 * 沿 -Z 方向下滑，s = -z 是已经下降的水平距离。
 * 坡度由多个正弦叠加而成，积分后得到高度，保证坡面连续、可无限延伸。
 */
const BASE = 0.225
const AMP_1 = 0.072
const FREQ_1 = 0.017
const AMP_2 = 0.031
const FREQ_2 = 0.053
const PHASE_2 = 1.25

/** 雪道基础半宽 */
const BASE_HALF = 8.1
const HALF_MIN = 6.5
const HALF_MAX = 11.3

export function slopeAt(z: number): number {
  const s = Math.max(0, -z)
  return BASE + AMP_1 * Math.sin(FREQ_1 * s) + AMP_2 * Math.sin(FREQ_2 * s + PHASE_2)
}

/** 坡度角（弧度），用于模型和镜头的俯仰 */
export function slopeAngleAt(z: number): number {
  return Math.atan(slopeAt(z))
}

export function heightAt(z: number): number {
  const s = Math.max(0, -z)
  const term1 = (AMP_1 / FREQ_1) * (1 - Math.cos(FREQ_1 * s))
  const term2 = (AMP_2 / FREQ_2) * (Math.cos(PHASE_2) - Math.cos(FREQ_2 * s + PHASE_2))
  return -(BASE * s + term1 + term2)
}

/**
 * 雪道半宽。两个正弦叠加，让雪道在 6.5 ~ 11.3 米之间缓慢变宽变窄，
 * 每隔一两百米就能明显看出收窄和展开。
 */
export function courseHalfWidthAt(z: number): number {
  const s = Math.max(0, -z)
  const wobble = 1.8 * Math.sin(s * 0.011) + 1.2 * Math.sin(s * 0.027 + 0.6)
  return Math.min(HALF_MAX, Math.max(HALF_MIN, BASE_HALF + wobble))
}

/** 某一帧滑行速度对应的水平速度占比 */
export function horizontalFactor(z: number): number {
  return Math.cos(slopeAngleAt(z))
}
