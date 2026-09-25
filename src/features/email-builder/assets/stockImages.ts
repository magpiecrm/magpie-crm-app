/**
 * Curated stock imagery for the copilot.
 *
 * There is no image-search API key configured, and an invented image URL is
 * worse than none — it renders as a broken box in the recipient's inbox. So the
 * copilot picks from a fixed, known-good set instead of guessing. These are the
 * same Unsplash photos the starter templates already ship, plus a few more, all
 * addressed through `images.unsplash.com` with explicit sizing.
 *
 * Swap these for your own CDN assets when you have them; the shape is the only
 * thing the tool depends on.
 */
export interface StockImage {
  id: string
  /** Unsplash photo id, used to build the URL. */
  photo: string
  description: string
  tags: string[]
}

export const STOCK_IMAGES: StockImage[] = [
  { id: 'workspace-desk', photo: 'photo-1497366754035-f200968a6e72', description: 'Bright modern office desk with laptop', tags: ['office', 'work', 'desk', 'business', 'saas', 'tech'] },
  { id: 'team-meeting', photo: 'photo-1522071820081-009f0129c71c', description: 'Team collaborating around a table', tags: ['team', 'meeting', 'people', 'collaboration', 'business'] },
  { id: 'laptop-code', photo: 'photo-1461749280684-dccba630e2f6', description: 'Code on a laptop screen', tags: ['code', 'developer', 'software', 'tech', 'engineering'] },
  { id: 'analytics-chart', photo: 'photo-1551288049-bebda4e38f71', description: 'Analytics dashboard on a screen', tags: ['analytics', 'data', 'chart', 'metrics', 'report', 'dashboard'] },
  { id: 'handshake', photo: 'photo-1521737711867-e3b97375f902', description: 'Two people shaking hands', tags: ['deal', 'partnership', 'sales', 'welcome', 'business'] },
  { id: 'coffee-shop', photo: 'photo-1554118811-1e0d58224f24', description: 'Coffee shop interior with seating', tags: ['coffee', 'cafe', 'food', 'hospitality', 'restaurant'] },
  { id: 'coffee-cup', photo: 'photo-1495474472287-4d71bcdd2085', description: 'Latte in a ceramic cup from above', tags: ['coffee', 'drink', 'cafe', 'food'] },
  { id: 'fashion-rail', photo: 'photo-1441986300917-64674bd600d8', description: 'Clothing rail in a retail store', tags: ['retail', 'fashion', 'clothing', 'shop', 'ecommerce', 'store'] },
  { id: 'sneakers', photo: 'photo-1542291026-7eec264c27ff', description: 'Red sneaker product shot', tags: ['product', 'shoes', 'sneakers', 'ecommerce', 'retail', 'fashion'] },
  { id: 'watch-product', photo: 'photo-1523275335684-37898b6baf30', description: 'Wristwatch product shot on white', tags: ['product', 'watch', 'accessory', 'ecommerce', 'luxury'] },
  { id: 'skincare', photo: 'photo-1556228720-195a672e8a03', description: 'Skincare bottles on a neutral background', tags: ['product', 'beauty', 'skincare', 'cosmetics', 'ecommerce'] },
  { id: 'packages', photo: 'photo-1553062407-98eeb64c6a62', description: 'Stacked shipping boxes', tags: ['shipping', 'delivery', 'logistics', 'order', 'packaging'] },
  { id: 'warehouse', photo: 'photo-1553413077-190dd305871c', description: 'Warehouse aisle with shelving', tags: ['warehouse', 'logistics', 'supply', 'industrial', 'shipping'] },
  { id: 'city-skyline', photo: 'photo-1449824913935-59a10b8d2000', description: 'City skyline at dusk', tags: ['city', 'urban', 'travel', 'property', 'real estate'] },
  { id: 'nature-mountains', photo: 'photo-1470071459604-3b5ec3a7fe05', description: 'Misty mountain landscape', tags: ['nature', 'landscape', 'outdoors', 'travel', 'calm'] },
  { id: 'beach', photo: 'photo-1507525428034-b723cf961d3e', description: 'Tropical beach and clear water', tags: ['beach', 'travel', 'holiday', 'summer', 'vacation'] },
  { id: 'newsletter-desk', photo: 'photo-1499750310107-5fef28a66643', description: 'Writing desk with notebook and coffee', tags: ['newsletter', 'writing', 'blog', 'editorial', 'content'] },
  { id: 'books', photo: 'photo-1481627834876-b7833e8f5570', description: 'Stack of books on a shelf', tags: ['books', 'reading', 'education', 'learning', 'editorial'] },
  { id: 'conference', photo: 'photo-1540575467063-178a50c2df87', description: 'Audience at a conference talk', tags: ['event', 'conference', 'webinar', 'talk', 'announcement'] },
  { id: 'celebration', photo: 'photo-1530103862676-de8c9debad1d', description: 'Confetti celebration', tags: ['celebration', 'launch', 'party', 'announcement', 'sale'] },
  { id: 'gym', photo: 'photo-1534438327276-14e5300c3a48', description: 'Gym interior with equipment', tags: ['fitness', 'gym', 'health', 'sport', 'wellness'] },
  { id: 'healthcare', photo: 'photo-1576091160399-112ba8d25d1d', description: 'Clinical setting with a stethoscope', tags: ['health', 'medical', 'healthcare', 'clinic', 'care'] },
  { id: 'plants', photo: 'photo-1416879595882-3373a0480b5b', description: 'Green houseplants by a window', tags: ['plants', 'green', 'home', 'sustainability', 'nature'] },
  { id: 'food-table', photo: 'photo-1504754524776-8f4f37790ca0', description: 'Plated meal on a wooden table', tags: ['food', 'restaurant', 'meal', 'dining', 'recipe'] },
  { id: 'abstract-gradient', photo: 'photo-1557682224-5b8590cd9ec5', description: 'Soft abstract colour gradient', tags: ['abstract', 'background', 'gradient', 'texture', 'hero'] },
]

/** Build a sized Unsplash URL for a catalogue entry. */
export function stockImageUrl(photo: string, width = 600): string {
  return `https://images.unsplash.com/${photo}?w=${width}&auto=format&fit=crop`
}
