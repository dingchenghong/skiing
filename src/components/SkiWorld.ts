import { defineComponent, onBeforeUnmount, watch } from 'vue'
import { useLoop, useTres } from '@tresjs/core'
import * as THREE from 'three'
import { SkiRun } from '@/game/SkiRun'
import type { HudSnapshot, JacketOption, RunResult } from '@/game/data'

export default defineComponent({
  name: 'SkiWorld',
  props: {
    jacket: {
      type: Object as () => JacketOption,
      required: true,
    },
  },
  emits: ['ready', 'hud', 'toast', 'gameover'],
  setup(props, { emit, expose }) {
    const tres = useTres()
    const { onBeforeRender } = useLoop()
    let game: SkiRun | null = null
    let ready = false

    const worldReady = watch(
      [tres.scene, tres.camera],
      ([sceneRef, cameraRef]) => {
        if (ready || !sceneRef || !cameraRef) return
        game = new SkiRun({
          scene: sceneRef as unknown as THREE.Scene,
          camera: cameraRef as THREE.PerspectiveCamera,
          jacket: props.jacket,
          onHud: (hud: HudSnapshot) => emit('hud', hud),
          onToast: toast => emit('toast', toast),
          onGameOver: (result: RunResult) => emit('gameover', result),
        })
        ready = true
        emit('ready')
      },
      { immediate: true },
    )

    watch(
      () => props.jacket,
      jacket => {
        game?.setJacket(jacket)
      },
      { deep: true },
    )

    const off = onBeforeRender(({ delta }) => {
      if (!game) return
      game.update(delta ?? 0.016)
    })

    onBeforeUnmount(() => {
      off.off()
      worldReady()
      game?.dispose()
      game = null
    })

    const api = {
      start: () => game?.start(),
      restart: () => game?.restart(),
      resetToReady: () => game?.resetToReady(),
      pause: () => game?.pause(),
      resume: () => game?.resume(),
      togglePause: () => game?.togglePause() ?? false,
      quit: () => game?.quit(),
      jump: () => game?.jump(),
      setTouch: (action: 'left' | 'right' | 'up' | 'down', pressed: boolean) => game?.setTouch(action, pressed),
      setSteer: (value: number) => game?.setSteer(value),
    }
    expose(api)

    return () => null
  },
})
