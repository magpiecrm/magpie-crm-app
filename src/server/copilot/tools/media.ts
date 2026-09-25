import { z } from 'zod'
import { defineTool } from '../types'

export const mediaTools = [
  defineTool({
    name: 'searchImages',
    description:
      'Find a stock image URL by topic. Always source images here — an invented image URL renders as a broken box in the recipient\'s inbox. Returns ready-to-use URLs for an `image`, `logo`, or grid item.',
    input: {
      query: z.string().optional().describe('Topic, e.g. "coffee", "team", "sneakers". Omit to browse everything.'),
      width: z.number().int().min(100).max(1400).optional()
        .describe('Pixel width to request. Defaults to 600 (full content width).'),
    },
    target: 'server',
    readOnly: true,
    handler: async ({ query, width }) => {
      const { STOCK_IMAGES, stockImageUrl } = await import(
        '../../../features/email-builder/assets/stockImages'
      )
      const w = width ?? 600
      const toResult = (img: (typeof STOCK_IMAGES)[number]) => ({
        id: img.id,
        description: img.description,
        tags: img.tags,
        url: stockImageUrl(img.photo, w),
        // A sensible default so the model does not have to invent one.
        suggestedAlt: img.description,
      })

      if (!query?.trim()) return { count: STOCK_IMAGES.length, images: STOCK_IMAGES.map(toResult) }

      const q = query.toLowerCase().trim()
      const words = q.split(/\s+/).filter(Boolean)
      const scored = STOCK_IMAGES
        .map(img => {
          const haystack = [img.id, img.description, ...img.tags].join(' ').toLowerCase()
          const score = words.reduce((acc, word) => acc + (haystack.includes(word) ? 1 : 0), 0)
          return { img, score }
        })
        .filter(s => s.score > 0)
        .sort((a, b) => b.score - a.score)

      if (scored.length > 0) {
        return { count: scored.length, images: scored.map(s => toResult(s.img)) }
      }

      // Never answer with nothing: the alternative is an invented URL.
      return {
        count: 0,
        images: STOCK_IMAGES.map(toResult),
        note: `No image matches "${query}". The whole catalogue is returned above — pick the closest, or tell the user to supply their own URL.`,
      }
    },
  }),
]
