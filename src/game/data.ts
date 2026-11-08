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

export type AttackKind = 'punch' | 'kick'
export type ActionKind = AttackKind | 'jump' | 'bomb'

export interface AttackConfig {
  label: string
  /** 冷却时间（秒） */
  cooldown: number
  /** 前后方向可命中的距离 */
  range: number
  /** 左右方向可命中的距离 */
  reach: number
  /** 命中得分 */
  bonus: number
  /** 对对手造成的伤害 */
  damage: number
  /** 动作动画时长 */
  duration: number
}

/** 贴身攻击：挥雪杖打人、抬脚踢人 */
export const ATTACK_CONFIG: Record<AttackKind, AttackConfig> = {
  punch: { label: '挥杆', cooldown: 0.5, range: 3.6, reach: 3, bonus: 150, damage: 60, duration: 0.5 },
  kick: { label: '飞踢', cooldown: 0.7, range: 3, reach: 2.6, bonus: 220, damage: 80, duration: 0.58 },
}

export interface RivalConfig {
  /** 对手满血值 */
  maxHealth: number
  /** 击倒对手的额外得分 */
  koBonus: number
  /** 对手主动出手的距离 */
  attackRange: number
  /** 对手两次出手的间隔 */
  attackInterval: number
}

export const RIVAL_CONFIG: RivalConfig = {
  maxHealth: 100,
  koBonus: 200,
  attackRange: 2.4,
  attackInterval: 2.2,
}

export interface BombConfig {
  label: string
  cooldown: number
  /** 丢下后多久才会被靠近的对手引爆 */
  armDelay: number
  /** 对手进入这个半径就会引爆 */
  triggerRadius: number
  /** 爆炸伤害半径 */
  radius: number
  /** 每命中一人得分 */
  bonus: number
  /** 对对手造成的伤害 */
  damage: number
  /** 动作动画时长 */
  duration: number
  /** 最多在雪地上躺多久 */
  life: number
}

/** 爆弹：丢在身后，靠近的对手会把它引爆 */
export const BOMB_CONFIG: BombConfig = {
  label: '爆弹',
  cooldown: 2.6,
  armDelay: 0.35,
  triggerRadius: 2.4,
  radius: 5,
  bonus: 260,
  damage: 140,
  duration: 0.5,
  life: 2.4,
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
