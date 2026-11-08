import { createRouter, createWebHistory } from 'vue-router'
import SkiGameView from '@/views/SkiGameView.vue'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/',
      name: 'ski',
      component: SkiGameView,
    },
  ],
})

export default router
