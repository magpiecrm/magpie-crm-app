// Centralized TanStack Query keys. Use these everywhere instead of inline
// arrays so query reads and `invalidateQueries` calls stay in sync.
//
// Note: list-of-contacts has two historical shapes that are intentionally
// preserved here — `listContacts` (the list-detail page) and `contactsByList`
// (the contacts page filter). They address different caches.

export const queryKeys = {
  prospects: {
    status: () => ['prospects', 'status'] as const,
    senderHealth: () => ['prospects', 'sender-health'] as const,
    /** Revealed emails for the current search: in-memory only, never fetched. */
    reveals: () => ['prospects', 'reveals'] as const,
    companies: (filters: unknown) => ['prospects', 'companies', filters] as const,
    people: (filters: unknown) => ['prospects', 'people', filters] as const,
    job: (id: string) => ['prospects', 'job', id] as const,
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
    listUnconfirmed: (listId: number) => ['email', 'list', listId, 'unconfirmed'] as const,
    campaigns: () => ['email', 'campaigns'] as const,
    campaign: (id: string | number | undefined) => ['email', 'campaign', id] as const,
    campaignActivity: (id: string | number) => ['email', 'campaign', id, 'activity'] as const,
    contact: (email: string) => ['email', 'contact', email] as const,
    forms: () => ['email', 'forms'] as const,
    form: (id: string) => ['email', 'forms', id] as const,
    formSubmissions: (formId: string) => ['email', 'forms', formId, 'submissions'] as const,
    contactFields: () => ['email', 'contactFields'] as const,
  },
  sales: {
    companies: () => ['sales', 'companies'] as const,
    company: (id: string) => ['sales', 'companies', id] as const,
    pipelines: () => ['sales', 'pipelines'] as const,
    /** Without filters, the prefix of every deals list (for invalidating them all). */
    deals: (filters?: unknown) => (filters === undefined ? (['sales', 'deals'] as const) : (['sales', 'deals', filters] as const)),
    deal: (id: string) => ['sales', 'deal', id] as const,
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
    providers: () => ['copilot', 'providers'] as const,
  },
  settings: {
    /** Everything the settings menu's status dots and Overview read. */
    all: () => ['settings'] as const,
    copilot: () => ['settings', 'copilot'] as const,
    sending: () => ['settings', 'sending'] as const,
    sendingDomains: () => ['settings', 'sending', 'domains'] as const,
    team: () => ['settings', 'team'] as const,
    usage: () => ['settings', 'usage'] as const,
  },
  notifications: {
    list: () => ['notifications'] as const,
  },
} as const
