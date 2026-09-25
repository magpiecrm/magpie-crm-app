import type { PersonaFormValues, PersonaUpdates } from '../prospects/components/PersonaForm'

type Listener = () => void
let listeners: Listener[] = []

export const copilotStore = {
  personaContext: null as { persona: PersonaFormValues } | null,
  onPersonaAction: null as ((updates: PersonaUpdates) => void) | null,
  
  setPersonaContext: (ctx: { persona: PersonaFormValues } | null) => {
    copilotStore.personaContext = ctx
    copilotStore.notify()
  },
  setOnPersonaAction: (action: ((updates: PersonaUpdates) => void) | null) => {
    copilotStore.onPersonaAction = action
    copilotStore.notify()
  },
  
  subscribe: (listener: Listener) => {
    listeners.push(listener)
    return () => {
      listeners = listeners.filter(l => l !== listener)
    }
  },
  notify: () => {
    listeners.forEach(l => l())
  }
}
