import type { FilterDefinition, QueryWindow } from '../../shared/types.js'

export type SearchRequest = { id: number; definition: FilterDefinition; limit: number; offset: number; window?: QueryWindow; ids?: number[] }
