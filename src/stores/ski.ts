import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { GAME, JACKETS, jacketById } from '@/game/data'
import { skiAudio } from '@/game/audio'

function read(key: string): string | null {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

function write(key: string, value: string): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(key, value)
  } catch {
    /* ignore private mode */
  }
}

export const useSkiStore = defineStore('ski', () => {
  const storedJacket = read(GAME.jacketKey)
  const jacketId = ref(
    JACKETS.some((item) => item.id === storedJacket) ? storedJacket! : JACKETS[0]!.id,
  )
  const best = ref(Math.max(0, Number(read(GAME.bestKey) ?? 0) || 0))
  const muted = ref(read(GAME.mutedKey) === '1')
  const jacket = computed(() => jacketById(jacketId.value))

  function setJacket(id: string): void {
    if (!JACKETS.some((item) => item.id === id)) return
    jacketId.value = id
    write(GAME.jacketKey, id)
  }

  function setMuted(value: boolean): void {
    muted.value = value
    write(GAME.mutedKey, value ? '1' : '0')
    skiAudio.setMuted(value)
  }

  function recordRun(score: number): boolean {
    if (score <= best.value) return false
    best.value = score
    write(GAME.bestKey, String(score))
    return true
  }

  skiAudio.setMuted(muted.value)

  return { jacketId, jacket, best, muted, setJacket, setMuted, recordRun }
})
