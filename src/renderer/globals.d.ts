import type { RasedApi } from '@shared/api.js'

declare global {
  interface Window {
    rased: RasedApi
  }
}

export {}
