import { Briefcase, Factory, MapPin, Users2, Sparkles, Layers } from 'lucide-react'
import { SENIORITY_LABEL } from '../../../server/prospecting/types'
import type { PersonaCriteria } from '../types'

interface PersonaMindMapProps {
  name: string
  criteria: PersonaCriteria
}

interface Branch {
  key: string
  label: string
  icon: React.ReactNode
  leaves: string[]
  hue: string
}

const WIDTH = 560
const HEIGHT = 440
const CENTER = { x: WIDTH / 2, y: HEIGHT / 2 }
const BRANCH_RADIUS = 130
const LEAF_RADIUS = 205
const MAX_LEAVES = 4

function pointOnCircle(radius: number, angle: number) {
  return {
    x: CENTER.x + radius * Math.cos(angle),
    y: CENTER.y + radius * Math.sin(angle),
  }
}

// Curved connector from the center toward a node: a quadratic Bézier whose
// control point is pushed perpendicular to the chord for a gentle arc.
function curvedPath(from: { x: number; y: number }, to: { x: number; y: number }, bend = 0.15) {
  const mx = (from.x + to.x) / 2
  const my = (from.y + to.y) / 2
  const dx = to.x - from.x
  const dy = to.y - from.y
  const cx = mx - dy * bend
  const cy = my + dx * bend
  return `M ${from.x} ${from.y} Q ${cx} ${cy} ${to.x} ${to.y}`
}

export function PersonaMindMap({ name, criteria }: PersonaMindMapProps) {
  const branches: Branch[] = [
    { key: 'titles', label: 'Job titles', icon: <Briefcase className="w-3.5 h-3.5" />, leaves: criteria.titles, hue: 'var(--accent)' },
    { key: 'seniorities', label: 'Seniority', icon: <Layers className="w-3.5 h-3.5" />, leaves: criteria.seniorities.map((s) => SENIORITY_LABEL[s]), hue: 'var(--accent)' },
    { key: 'industries', label: 'Industries', icon: <Factory className="w-3.5 h-3.5" />, leaves: criteria.industries, hue: 'var(--accent)' },
    { key: 'companySizes', label: 'Company size', icon: <Users2 className="w-3.5 h-3.5" />, leaves: criteria.companySizes, hue: 'var(--accent)' },
    { key: 'country', label: 'Country', icon: <MapPin className="w-3.5 h-3.5" />, leaves: criteria.country ? [criteria.country] : [], hue: 'var(--accent)' },
    { key: 'keyword', label: 'Keyword', icon: <Sparkles className="w-3.5 h-3.5" />, leaves: criteria.keyword ? [criteria.keyword] : [], hue: 'var(--accent)' },
  ]

  // Evenly spaced around the circle, starting at the top, going clockwise.
  const angles = branches.map((_, i) => ((-90 + (360 / branches.length) * i) * Math.PI) / 180)

  const centerLabel = name.trim() || 'Untitled persona'

  return (
    <div className="w-full flex justify-center">
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="w-full h-auto" style={{ maxWidth: WIDTH }}>
        {branches.map((branch, i) => {
          const angle = angles[i]
          const branchPoint = pointOnCircle(BRANCH_RADIUS, angle)
          const hasLeaves = branch.leaves.length > 0
          const visibleLeaves = branch.leaves.slice(0, MAX_LEAVES)
          const overflow = branch.leaves.length - visibleLeaves.length
          const leafSpread = Math.min(26, 130 / branches.length) // degrees of fan spread across leaves
          const leafCount = visibleLeaves.length + (overflow > 0 ? 1 : 0)

          return (
            <g key={branch.key}>
              {/* Center -> branch connector */}
              <path
                d={curvedPath(CENTER, branchPoint)}
                fill="none"
                stroke={hasLeaves ? branch.hue : 'var(--border)'}
                strokeOpacity={hasLeaves ? 0.35 : 1}
                strokeWidth={2}
              />

              {/* Branch node */}
              <foreignObject
                x={branchPoint.x - 55}
                y={branchPoint.y - 16}
                width={110}
                height={32}
              >
                <div
                  className={`h-full flex items-center justify-center gap-1.5 rounded-full border px-3 text-xs font-medium ${
                    hasLeaves
                      ? 'border-accent/40 bg-accent/10 text-accent'
                      : 'border-border bg-card text-muted-foreground border-dashed'
                  }`}
                >
                  {branch.icon}
                  <span className="truncate">{branch.label}</span>
                </div>
              </foreignObject>

              {/* Branch -> leaf connectors + leaves */}
              {leafCount > 0 &&
                Array.from({ length: leafCount }).map((_, li) => {
                  const spreadStart = angle - ((leafSpread / 2) * (leafCount - 1) * Math.PI) / 180
                  const leafAngle = spreadStart + (li * leafSpread * Math.PI) / 180
                  const leafPoint = pointOnCircle(LEAF_RADIUS, leafAngle)
                  const isOverflow = overflow > 0 && li === leafCount - 1
                  const text = isOverflow ? `+${overflow} more` : visibleLeaves[li]

                  return (
                    <g key={`${text}-${li}`} className="animate-in fade-in duration-300">
                      <path
                        d={curvedPath(branchPoint, leafPoint, 0.1)}
                        fill="none"
                        stroke="var(--border)"
                        strokeWidth={1}
                        strokeDasharray="3 3"
                      />
                      <foreignObject
                        x={leafPoint.x - 50}
                        y={leafPoint.y - 12}
                        width={100}
                        height={24}
                      >
                        <div className="h-full flex items-center justify-center">
                          <span className="max-w-full truncate rounded-md-xs bg-muted text-foreground/80 text-[10px] font-medium px-2 py-1 border border-border/50">
                            {text}
                          </span>
                        </div>
                      </foreignObject>
                    </g>
                  )
                })}
            </g>
          )
        })}

        {/* Center node (drawn last so branch lines sit behind it) */}
        <foreignObject x={CENTER.x - 75} y={CENTER.y - 28} width={150} height={56}>
          <div className="h-full flex items-center justify-center rounded-md-m bg-accent text-accent-foreground shadow-accent px-3 text-center">
            <span className="text-sm font-semibold leading-tight line-clamp-2">{centerLabel}</span>
          </div>
        </foreignObject>
      </svg>
    </div>
  )
}
