<script setup lang="ts">
import { ref } from 'vue'
import { TresCanvas } from '@tresjs/core'
import SkiWorld from './SkiWorld'
import type { HudSnapshot, JacketOption, RunResult } from '@/game/data'

defineProps<{
  jacket: JacketOption
}>()

const emit = defineEmits<{
  ready: []
  hud: [hud: HudSnapshot]
  toast: [toast: { text: string; tone: 'good' | 'bad' | 'info' }]
  gameover: [result: RunResult]
}>()

interface WorldApi {
  start: () => void
  restart: () => void
  resetToReady: () => void
  pause: () => void
  resume: () => void
  togglePause: () => boolean
  quit: () => void
  jump: () => void
  setTouch: (action: 'left' | 'right' | 'up' | 'down', pressed: boolean) => void
  setSteer: (value: number) => void
}

const world = ref<WorldApi | null>(null)

function onReady(): void {
  emit('ready')
}

defineExpose({
  start: () => world.value?.start(),
  restart: () => world.value?.restart(),
  resetToReady: () => world.value?.resetToReady(),
  pause: () => world.value?.pause(),
  resume: () => world.value?.resume(),
  togglePause: () => world.value?.togglePause() ?? false,
  quit: () => world.value?.quit(),
  jump: () => world.value?.jump(),
  setTouch: (action: 'left' | 'right' | 'up' | 'down', pressed: boolean) =>
    world.value?.setTouch(action, pressed),
  setSteer: (value: number) => world.value?.setSteer(value),
})
</script>

<template>
  <TresCanvas
    :shadows="true"
    :antialias="true"
    :dpr="[1, 2]"
    clear-color="#dfeaf7"
    class="ski-canvas"
  >
    <SkiWorld
      ref="world"
      :jacket="jacket"
      @ready="onReady"
      @hud="emit('hud', $event)"
      @toast="emit('toast', $event)"
      @gameover="emit('gameover', $event)"
    />
  </TresCanvas>
</template>

<style scoped>
.ski-canvas {
  width: 100%;
  height: 100%;
  display: block;
}
</style>
