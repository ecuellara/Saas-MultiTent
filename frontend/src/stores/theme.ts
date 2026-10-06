import { defineStore } from 'pinia'

type Tema = 'light' | 'dark'

/**
 * Tema claro/oscuro. El `index.html` ya aplica la clase antes de pintar (anti
 * FOUC), así que aquí solo se mantiene sincronizado.
 */
export const useThemeStore = defineStore('theme', {
  state: () => ({
    tema: (localStorage.getItem('theme') as Tema | null) ?? 'light',
  }),
  getters: {
    oscuro: (s) => s.tema === 'dark',
  },
  actions: {
    aplicar(): void {
      document.documentElement.classList.toggle('dark', this.tema === 'dark')
      document.documentElement.style.colorScheme = this.tema
      localStorage.setItem('theme', this.tema)
    },
    alternar(): void {
      this.tema = this.tema === 'dark' ? 'light' : 'dark'
      this.aplicar()
    },
  },
})
