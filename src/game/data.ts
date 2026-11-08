export interface JacketOption {
  id: string
  name: string
  color: string
  accent: string
}

/** 滑雪服配色，全部使用程序化材质，不依赖贴图 */
export const JACKETS: JacketOption[] = [
  { id: 'glacier', name: '冰川蓝', color: '#38bdf8', accent: '#e0f7ff' },
  { id: 'ember', name: '熔岩橙', color: '#ff7a3d', accent: '#ffe3cf' },
  { id: 'pine', name: '雪松绿', color: '#2fae7d', accent: '#d9f8e8' },
  { id: 'berry', name: '莓果红', color: '#f43f6d', accent: '#ffe1ea' },
  { id: 'aurora', name: '极光紫', color: '#9a7bff', accent: '#eee6ff' },
  { id: 'lemon', name: '柠檬黄', color: '#ffd23f', accent: '#fff7cf' },
]

export function jacketById(id: string): JacketOption {
  return JACKETS.find(item => item.id === id) ?? JACKETS[0]!
}

export type ObstacleKind = 'snowball' | 'rock' | 'tree' | 'log'

export type HazardKind = 'scissors' | 'icicle' | 'rock'

export interface HazardConfig {
  label: string
  health: number
  penalty: number
}

/** 空中危险物的伤害与扣分 */
export const HAZARD_CONFIG: Record<HazardKind, HazardConfig> = {
  scissors: { label: '剪刀', health: 12, penalty: 90 },
  icicle: { label: '冰锥', health: 14, penalty: 110 },
  rock: { label: '石块', health: 18, penalty: 140 },
}

export interface ObstacleConfig {
  label: string
  health: number
  penalty: number
  radius: number
  /** 跳起高于这个高度就能越过去 */
  clearance: number
}

export const OBSTACLE_CONFIG: Record<ObstacleKind, ObstacleConfig> = {
  snowball: { label: '雪团', health: 14, penalty: 90, radius: 0.7, clearance: 1.05 },
  rock: { label: '岩石', health: 26, penalty: 160, radius: 0.85, clearance: 1.15 },
  tree: { label: '雪松', health: 30, penalty: 190, radius: 0.78, clearance: 2.7 },
  log: { label: '倒木', health: 22, penalty: 140, radius: 0.98, clearance: 0.82 },
}

export const GAME = {
  maxHealth: 100,
  maxSpeed: 54,
  minSpeed: 2.5,
  steerSpeed: 7.6,  jumpVelocity: 11.2,
  jumpGravity: 19.5,  courseHalfWidth: 8.1,
  chunkLength: 20,
  viewAhead: 200,
  readyScore: 0,
  bestKey: 'ski.best.v1',
  jacketKey: 'ski.jacket.v1',
  mutedKey: 'ski.muted.v1',
}

export interface HudSnapshot {
  score: number
  distance: number
  speed: number
  health: number
  slope: number
  hits: number
  best: number
  danger: number
  damageFlash: number
  airborne: boolean
}

export interface RunResult {
  score: number
  distance: number
  hits: number
  reason: 'health' | 'quit'
  maxSpeed: number
}
