import type { PersonaFormValues, PersonaUpdates } from '../prospects/components/PersonaForm'

type Listener = () => void
let listeners: Listener[] = []

/** Which chat answers a request: the app's side panel, or the email builder's own. */
export type CopilotChatTarget = 'main' | 'builder'

export const copilotStore = {
  personaContext: null as { persona: PersonaFormValues } | null,
  onPersonaAction: null as ((updates: PersonaUpdates) => void) | null,
  /** A request waiting to be sent, as if typed: "Fix with AI" (spam-score). */
  pendingPrompt: null as { text: string; target: CopilotChatTarget } | null,

  /** Opens that chat and sends this. */
  ask: (text: string, target: CopilotChatTarget = 'main') => {
    copilotStore.pendingPrompt = { text, target }
    copilotStore.notify()
  },
  /** The waiting request for this chat, taken so it's sent once. */
  takePrompt: (target: CopilotChatTarget): string | null => {
    const p = copilotStore.pendingPrompt
    if (!p || p.target !== target) return null
    copilotStore.pendingPrompt = null
    copilotStore.notify()
    return p.text
  },
  
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
