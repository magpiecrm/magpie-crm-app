// Centralized TanStack Query keys. Use these everywhere instead of inline
// arrays so query reads and `invalidateQueries` calls stay in sync.
//
// Note: list-of-contacts has two historical shapes that are intentionally
// preserved here — `listContacts` (the list-detail page) and `contactsByList`
// (the contacts page filter). They address different caches.

export const queryKeys = {
  lusha: {
    usage: () => ['lusha', 'usage'] as const,
  },
  prospects: {
    search: (filters: unknown) => ['prospects', filters] as const,
    personas: () => ['prospects', 'personas'] as const,
    persona: (id: string) => ['prospects', 'personas', id] as const,
  },
  email: {
    lists: () => ['email', 'lists'] as const,
    senders: () => ['email', 'senders'] as const,
    contacts: () => ['email', 'contacts'] as const,
    contactsAll: () => ['email', 'contacts', 'all'] as const,
    contactsByList: (listId: number | null) => ['email', 'contacts', 'list', listId] as const,
    listContacts: (listId: string | number) => ['email', 'list', listId, 'contacts'] as const,
    campaigns: () => ['email', 'campaigns'] as const,
    campaign: (id: string | number | undefined) => ['email', 'campaign', id] as const,
    contact: (email: string) => ['email', 'contact', email] as const,
    forms: () => ['email', 'forms'] as const,
    form: (id: string) => ['email', 'forms', id] as const,
    formSubmissions: (formId: string) => ['email', 'forms', formId, 'submissions'] as const,
    contactFields: () => ['email', 'contactFields'] as const,
  },
  surveys: {
    list: () => ['surveys'] as const,
    survey: (id: string) => ['surveys', id] as const,
    summary: (id: string) => ['surveys', id, 'summary'] as const,
    responses: (id: string, filters?: unknown) => ['surveys', id, 'responses', filters] as const,
  },
  templates: {
    list: () => ['templates'] as const,
    template: (id: string) => ['templates', id] as const,
  },
  copilot: {
    chats: () => ['copilot', 'chats'] as const,
    chat: (id: string) => ['copilot', 'chats', id] as const,
  },
  notifications: {
    list: () => ['notifications'] as const,
  },
} as const
