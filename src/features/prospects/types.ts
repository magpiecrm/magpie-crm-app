export interface PersonaCriteria {
  title: string[]
  industry: string[]
  location: string[]
  employeeCount: string
  keywords: string[]
  seniority: string[]
  excludedTitles: string[]
}

export interface Persona {
  id: string
  name: string
  description: string
  criteria: PersonaCriteria
  painPoints: string
  valueProp: string
  created_at: string
  updated_at: string
}

export const DEFAULT_PERSONA_CRITERIA: PersonaCriteria = {
  title: [],
  industry: [],
  location: [],
  employeeCount: '',
  keywords: [],
  seniority: [],
  excludedTitles: [],
}

// Older persona records in the JSON db lack the newer criteria keys; fill them
// with defaults so every consumer sees the full shape.
export function normalizePersonaCriteria(raw: Partial<PersonaCriteria> | undefined | null): PersonaCriteria {
  return { ...DEFAULT_PERSONA_CRITERIA, ...(raw ?? {}) }
}
