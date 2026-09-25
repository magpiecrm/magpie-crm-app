import { createFileRoute, redirect } from '@tanstack/react-router'

export const Route = createFileRoute('/collection/')({
  beforeLoad: () => {
    throw redirect({ to: '/collection/prospect-search' })
  },
})
