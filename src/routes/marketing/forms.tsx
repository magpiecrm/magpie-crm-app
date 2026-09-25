import { createFileRoute, Outlet } from '@tanstack/react-router'

export const Route = createFileRoute('/marketing/forms')({
  component: () => <Outlet />,
})
