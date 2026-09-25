interface AvatarProps {
  name: string
  size?: 'sm' | 'md' | 'lg'
}

export function Avatar({ name, size = 'md' }: AvatarProps) {
  const initials = name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2)

  const sizes = {
    sm: 'w-6 h-6 text-[10px]',
    md: 'w-8 h-8 text-xs',
    lg: 'w-10 h-10 text-sm',
  }

  return (
    <div className={`${sizes[size]} rounded-full bg-accent/10 flex items-center justify-center font-bold text-accent flex-shrink-0`}>
      {initials}
    </div>
  )
}
