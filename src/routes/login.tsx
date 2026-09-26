import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { ArrowRight, Eye, EyeOff, Lock, Mail, ShieldAlert, CheckCircle2 } from 'lucide-react'
import { markSignedIn } from '../utils/auth'
import { loginFn, signInOptionsFn } from '../server/functions/auth'
import { MagpieLogo } from '../components/ui/MagpieLogo'

export const Route = createFileRoute('/login')({
  component: LoginPage,
})

/** Why a one-time sign-in link (/auth/link) didn't work. */
const LINK_ERRORS: Record<string, string> = {
  expired: 'That sign-in link has expired. Sign in again to get a new one.',
  used: 'That sign-in link has already been used. Sign in again to get a new one.',
  'unknown-user': "Your account isn't a user of this workspace. Ask its owner to add you.",
  invalid: "That sign-in link isn't valid. Sign in again to get a new one.",
}

function LoginPage() {
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [success, setSuccess] = useState(false)
  // Null until known, so the password form doesn't flash up where it's off.
  const [options, setOptions] = useState<{ passwordLogin: boolean; signInUrl: string | null } | null>(null)

  useEffect(() => {
    const link = new URLSearchParams(window.location.search).get('link')
    if (link) setError(LINK_ERRORS[link] ?? LINK_ERRORS.invalid)
    signInOptionsFn()
      .then(setOptions)
      .catch(() => setOptions({ passwordLogin: true, signInUrl: null }))
  }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setIsLoading(true)

    try {
      const response = await loginFn({ data: { email, password } })

      if (response.success) {
        // The server set the session cookie; the page never sees the token.
        markSignedIn()
        setSuccess(true)
        await new Promise((resolve) => setTimeout(resolve, 500))
        setIsLoading(false)
        navigate({ to: '/collection' })
      } else {
        setError(response.error || 'Invalid email or password. Please try again.')
        setIsLoading(false)
      }
    } catch (err) {
      console.error('Login failed with error:', err)
      setError('An unexpected error occurred. Please try again.')
      setIsLoading(false)
    }
  }

  return (
    <div className="min-h-[100dvh] w-full flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-md">
        {/* Logo / Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-md-m bg-card border border-border mb-5">
            <MagpieLogo size={36} />
          </div>
          <h1 className="text-3xl font-semibold font-display text-foreground">
            Welcome Back
          </h1>
          <p className="text-muted-foreground mt-2 text-sm">
            Sign in to your MagpieCRM workspace
          </p>
        </div>

        {/* Card wrapper */}
        <div className="bg-card p-6 sm:p-8 rounded-2xl border border-border shadow-lg">
          {options && !options.passwordLogin ? (
            <div className="space-y-6">
              {error && (
                <div className="p-4 rounded-xl bg-destructive/10 border border-destructive/20 flex items-start gap-3 text-destructive text-sm">
                  <ShieldAlert className="w-5 h-5 shrink-0 mt-0.5" />
                  <span>{error}</span>
                </div>
              )}
              {options.signInUrl ? (
                <a
                  href={options.signInUrl}
                  className="w-full py-3 px-4 rounded-md-s text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/85 transition-colors flex items-center justify-center gap-2"
                >
                  <span>Continue to sign in</span>
                  <ArrowRight className="w-4 h-4" />
                </a>
              ) : (
                <p className="text-sm text-muted-foreground text-center">
                  Sign in through your hosting provider to open this workspace.
                </p>
              )}
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-6">
              {error && (
                <div className="p-4 rounded-xl bg-destructive/10 border border-destructive/20 flex items-start gap-3 text-destructive text-sm">
                  <ShieldAlert className="w-5 h-5 shrink-0 mt-0.5" />
                  <span>{error}</span>
                </div>
              )}

              {success && (
                <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-start gap-3 text-emerald-700 dark:text-emerald-400 text-sm">
                  <CheckCircle2 className="w-5 h-5 shrink-0 mt-0.5 animate-bounce" />
                  <span>Login successful! Redirecting...</span>
                </div>
              )}

              <div className="space-y-2">
                <label htmlFor="email-input" className="text-sm font-medium text-foreground block">
                  Email Address
                </label>
                <div className="relative">
                  <span className="absolute inset-y-0 left-0 pl-3.5 flex items-center text-muted-foreground/75">
                    <Mail className="w-4 h-4" />
                  </span>
                  <input
                    id="email-input"
                    type="email"
                    required
                    placeholder="you@company.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full pl-10 pr-4 py-3 rounded-md-s border border-input bg-background text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-ring/40 focus:border-ring transition-colors text-sm"
                    disabled={isLoading || success}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <label htmlFor="password-input" className="text-sm font-medium text-foreground block">
                    Password
                  </label>
                </div>
                <div className="relative">
                  <span className="absolute inset-y-0 left-0 pl-3.5 flex items-center text-muted-foreground/75">
                    <Lock className="w-4 h-4" />
                  </span>
                  <input
                    id="password-input"
                    type={showPassword ? 'text' : 'password'}
                    required
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full pl-10 pr-10 py-3 rounded-md-s border border-input bg-background text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-ring/40 focus:border-ring transition-colors text-sm"
                    disabled={isLoading || success}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute inset-y-0 right-0 pr-3.5 flex items-center text-muted-foreground/75 hover:text-foreground transition-colors cursor-pointer"
                    disabled={isLoading || success}
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <button
                id="login-submit-button"
                type="submit"
                disabled={isLoading || success}
                className={`w-full py-3 px-4 rounded-md-s text-sm font-medium bg-primary text-primary-foreground transition-colors flex items-center justify-center gap-2 cursor-pointer ${
                  isLoading || success ? 'opacity-70 cursor-not-allowed' : 'hover:bg-primary/85'
                }`}
              >
                {isLoading ? (
                  <>
                    <div className="w-4 h-4 border-2 border-primary-foreground border-t-transparent rounded-full animate-spin" />
                    <span>Signing In...</span>
                  </>
                ) : (
                  <span>Sign In</span>
                )}
              </button>
            </form>
          )}

          <div className="mt-6 pt-6 border-t border-border/60 text-center">
            <p className="text-xs text-muted-foreground">
              Security Notice: System access requires valid company credentials.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
