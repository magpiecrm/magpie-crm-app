// Barrel for all server functions. Callers import from '.../server/functions';
// the endpoints themselves are organized by domain in the sibling modules.
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
export * from './templates'

if (typeof window === 'undefined') {
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
}

