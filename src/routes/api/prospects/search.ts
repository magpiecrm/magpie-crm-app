import { createFileRoute } from '@tanstack/react-router'

/**
 * A people search that sends its people as each batch of them is ready, so
 * Prospect Search shows the first ones while it keeps looking (a search can
 * take a minute or more). The body is the same as searchPeopleFn's; the reply
 * is newline-delimited JSON: `{"type":"people","items":[…],"refined":[…]}`
 * lines, then one `{"type":"done","page":{…}}` (searchPeopleFn's result) or
 * `{"type":"error","message":"…"}`. While a batch is being worked on, a
 * `{"type":"wait"}` line goes out every so often: a reply that says nothing
 * for a minute or two gets dropped by what's in between.
 */
const STILL_HERE_MS = 15_000

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

        const { joinSearch } = await import('../../../server/prospecting/searchRuns')

        const encoder = new TextEncoder()
        // Leaving the page stops the listening, not the search: it's joined again by asking for the same one (searchRuns.ts).
        let leave = () => {}
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            let open = true
            const send = (line: unknown) => {
              if (!open) return false
              try {
                controller.enqueue(encoder.encode(JSON.stringify(line) + '\n'))
                return true
              } catch {
                open = false
                return false
              }
            }
            const stillHere = setInterval(() => send({ type: 'wait' }), STILL_HERE_MS)
            const stop = joinSearch(
              JSON.stringify(input),
              (onPeople) => searchPeople(input, { onPeople: (found) => onPeople(found) }),
              (line) => {
                const reached = send(line)
                if (line.type !== 'people') {
                  clearInterval(stillHere)
                  if (open) controller.close()
                  open = false
                }
                return reached
              },
            )
            leave = () => {
              clearInterval(stillHere)
              open = false
              stop()
            }
          },
          cancel() {
            leave()
          },
        })
        return new Response(stream, {
          headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' },
        })
      },
    },
  },
})
