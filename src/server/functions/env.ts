import { createServerFn } from '@tanstack/react-start'

// Get env values
export const getEnvVarsFn = createServerFn({ method: 'GET' })
  .handler(async () => {
    try {
      const { requireAuth } = await import('../auth.server')
      await requireAuth()
    } catch (e) {
      return { success: false, error: 'Unauthorized' }
    }

    const path = await import('path')
    const fs = await import('fs')

    const envPath = path.resolve(process.cwd(), '.env')
    let content = ''
    try {
      content = fs.readFileSync(envPath, 'utf-8')
    } catch (e) {
      // If .env doesn't exist, ignore
    }

    // Parse the file key=value
    const vars: Record<string, string> = {}
    const lines = content.split('\n')
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const firstEq = trimmed.indexOf('=')
      if (firstEq === -1) continue
      const key = trimmed.slice(0, firstEq).trim()
      let val = trimmed.slice(firstEq + 1).trim()
      // Strip optional quotes
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1)
      }
      vars[key] = val
    }

    // Ensure all standard keys exist in returned object, fallback to process.env
    const keys = [
      'GENERECT_API_KEY',
      'SMTP_HOST',
      'SMTP_PORT',
      'SMTP_USER',
      'SMTP_PASS',
      'SMTP_SENDER',
      'AUTH_EMAIL',
      'AUTH_PASSWORD',
      'TRACKING_SECRET',
      'SUBSCRIBE_API_KEY'
    ]

    for (const key of keys) {
      if (!(key in vars)) {
        vars[key] = process.env[key] || (globalThis as any).Bun?.env?.[key] || ''
      }
    }

    return { success: true, vars }
  })

// Save env values
export const saveEnvVarsFn = createServerFn({ method: 'POST' })
  .inputValidator((d: { vars: Record<string, string> }) => d)
  .handler(async ({ data }) => {
    try {
      const { requireAuth } = await import('../auth.server')
      await requireAuth()
    } catch (e) {
      return { success: false, error: 'Unauthorized' }
    }

    const path = await import('path')
    const fs = await import('fs')

    const { vars } = data
    const envPath = path.resolve(process.cwd(), '.env')

    let content = ''
    try {
      content = fs.readFileSync(envPath, 'utf-8')
    } catch (e) {}

    const lines = content.split('\n')
    const updatedKeys = new Set<string>()
    const newLines: string[] = []

    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) {
        newLines.push(line)
        continue
      }
      const firstEq = trimmed.indexOf('=')
      if (firstEq === -1) {
        newLines.push(line)
        continue
      }
      const key = trimmed.slice(0, firstEq).trim()
      if (key in vars) {
        newLines.push(`${key}=${vars[key]}`)
        updatedKeys.add(key)
      } else {
        newLines.push(line)
      }
    }

    // Add new ones
    for (const [key, val] of Object.entries(vars)) {
      if (!updatedKeys.has(key)) {
        newLines.push(`${key}=${val}`)
      }
    }

    fs.writeFileSync(envPath, newLines.join('\n'), 'utf-8')

    // Apply in-memory so they take effect immediately
    for (const [key, val] of Object.entries(vars)) {
      process.env[key] = val
      if ((globalThis as any).Bun?.env) {
        (globalThis as any).Bun.env[key] = val
      }
    }

    return { success: true }
  })
