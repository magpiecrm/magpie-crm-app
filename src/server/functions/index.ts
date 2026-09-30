// Barrel for all server functions. Callers import from '.../server/functions';
// the endpoints themselves are organized by domain in the sibling modules.
import { createServerOnlyFn } from '@tanstack/react-start'

export * from './prospects'
export * from './lists'
export * from './contacts'
export * from './campaigns'
export * from './copilot'
export * from './auth'
export * from './emailSettings'
export * from './apiKeys'
export * from './users'
export * from './forms'
export * from './personas'
export * from './notifications'
export * from './push'
export * from './surveys'
export * from './usage'
export * from './templates'
export * from './sales'
export * from './proposals'
export * from './billing'

// Background jobs start on the server only. Wrapped in createServerOnlyFn so
// the client build drops the body, and with it the server-only modules the
// jobs load (the campaign sender reads the incoming request).
const startBackgroundJobs = createServerOnlyFn(() => {
  import('../emailScheduler').then(({ startEmailScheduler }) => {
    startEmailScheduler()
  }).catch(err => {
    console.error('Failed to start email scheduler:', err)
  })
  import('../prospecting/senderHealthMonitor').then(({ startSenderHealthMonitor }) => {
    startSenderHealthMonitor()
  }).catch(err => {
    console.error('Failed to start sender health monitor:', err)
  })
})

if (typeof window === 'undefined') startBackgroundJobs()
