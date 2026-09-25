import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useState, useEffect } from 'react'
import { Eye, EyeOff, Lock, Mail, ShieldAlert, CheckCircle2 } from 'lucide-react'
import { setAuthCookie, isAuthenticated } from '../utils/auth'
import { loginFn } from '../server/functions/auth'

export const Route = createFileRoute('/login')({
  component: LoginPage,
})

function LoginPage() {
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [success, setSuccess] = useState(false)

  useEffect(() => {
    // If already authenticated, redirect to collection page
    if (isAuthenticated()) {
      navigate({ to: '/collection' })
    }
  }, [navigate])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setIsLoading(true)

    try {
      const response = await loginFn({ data: { email, password } })

      if (response.success) {
        if ('token' in response && response.token) {
          const secureFlag = window.location.protocol === 'https:' ? '; Secure' : ''
          document.cookie = `auth_token=${encodeURIComponent(response.token as string)}; path=/; max-age=604800; SameSite=Strict${secureFlag}`
        }
        setAuthCookie('authenticated')
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
    <div className="min-h-[100dvh] w-full flex items-center justify-center bg-background relative overflow-hidden px-4">
      {/* Decorative blurred background shapes */}
      <div className="absolute top-[-10%] left-[-10%] w-[50vw] h-[50vw] rounded-full bg-accent/10 blur-[120px] pointer-events-none" />
      <div className="absolute bottom-[-10%] right-[-10%] w-[50vw] h-[50vw] rounded-full bg-accent-secondary/10 blur-[120px] pointer-events-none" />

      <div className="w-full max-w-md z-10">
        {/* Logo / Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-gradient-to-tr from-accent to-accent-secondary text-accent-foreground shadow-premium mb-4 animate-float">
            <Lock className="w-6 h-6" />
          </div>
          <h1 className="text-3xl font-bold font-display tracking-tight text-foreground">
            Welcome Back
          </h1>
          <p className="text-muted-foreground mt-2 text-sm">
            Sign in to access your B2B Prospecting & Email Marketing dashboard
          </p>
        </div>

        {/* Card wrapper */}
        <div className="glass-card p-6 sm:p-8 rounded-2xl border border-border shadow-xl">
          <form onSubmit={handleSubmit} className="space-y-6">
            {error && (
              <div className="p-4 rounded-xl bg-destructive/10 border border-destructive/20 flex items-start gap-3 text-destructive text-sm animate-pulse-custom">
                <ShieldAlert className="w-5 h-5 shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}

            {success && (
              <div className="p-4 rounded-xl bg-green-500/10 border border-green-500/20 flex items-start gap-3 text-green-500 text-sm">
                <CheckCircle2 className="w-5 h-5 shrink-0 mt-0.5 animate-bounce" />
                <span>Login successful! Redirecting...</span>
              </div>
            )}

            <div className="space-y-2">
              <label htmlFor="email-input" className="text-sm font-semibold text-foreground/90 block">
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
                  className="w-full pl-10 pr-4 py-3 rounded-xl border border-border bg-background text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-accent/50 focus:border-accent transition-all text-sm"
                  disabled={isLoading || success}
                />
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <label htmlFor="password-input" className="text-sm font-semibold text-foreground/90 block">
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
                  className="w-full pl-10 pr-10 py-3 rounded-xl border border-border bg-background text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-accent/50 focus:border-accent transition-all text-sm"
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
              className={`w-full py-3 px-4 rounded-xl text-sm font-semibold text-accent-foreground shadow-md transition-all flex items-center justify-center gap-2 cursor-pointer ${
                isLoading || success
                  ? 'bg-accent/70 cursor-not-allowed'
                  : 'bg-gradient-to-r from-accent to-accent-secondary hover:brightness-110 active:scale-[0.98]'
              }`}
            >
              {isLoading ? (
                <>
                  <div className="w-4 h-4 border-2 border-accent-foreground border-t-transparent rounded-full animate-spin" />
                  <span>Signing In...</span>
                </>
              ) : (
                <span>Sign In</span>
              )}
            </button>
          </form>

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
