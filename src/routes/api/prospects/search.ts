import { createFileRoute } from '@tanstack/react-router'

/**
 * A people search that sends its people as each batch of them is ready, so
 * Prospect Search shows the first ones while it keeps looking (a search can
 * take a minute or more). The body is the same as searchPeopleFn's; the reply
 * is newline-delimited JSON: `{"type":"people","items":[…],"refined":[…]}`
 * lines, then one `{"type":"done","page":{…}}` (searchPeopleFn's result) or
 * `{"type":"error","message":"…"}`.
 */
export const Route = createFileRoute('/api/prospects/search')({
  server: {
    handlers: {
      POST: async ({ request }: { request: Request }) => {
        const { requireAuth } = await import('../../../server/auth.server')
        try {
          await requireAuth()
        } catch {
          return new Response('Unauthorized', { status: 401 })
        }
        const { peopleSearchInput } = await import('../../../server/functions/prospects')
        let input
        try {
          input = peopleSearchInput.parse(await request.json())
        } catch {
          return new Response('Invalid search', { status: 400 })
        }
        const { searchPeople } = await import('../../../server/prospecting/search')

        const encoder = new TextEncoder()
        const stream = new ReadableStream<Uint8Array>({
          async start(controller) {
            let open = true
            const send = (line: unknown) => {
              if (!open) return
              try {
                controller.enqueue(encoder.encode(JSON.stringify(line) + '\n'))
              } catch {
                // The page went away; the search finishes (and is paid for) all the same.
                open = false
              }
            }
            try {
              const page = await searchPeople(input, { onPeople: (found) => send({ type: 'people', ...found }) })
              send({ type: 'done', page })
            } catch (err) {
              send({ type: 'error', message: err instanceof Error ? err.message : 'Search failed' })
            } finally {
              if (open) controller.close()
            }
          },
        })
        return new Response(stream, {
          headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' },
        })
      },
    },
  },
})
