import { useState } from 'react'
import { createFileRoute, Navigate } from '@tanstack/react-router'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card'
import { Button } from '~/components/ui/button'
import { GitBranch, Github, Loader2, Shield, Zap, Users, Moon, Sun } from 'lucide-react'
import { useAuth } from '~/hooks/use-auth'
import { useTheme } from '~/hooks/use-theme'

export const Route = createFileRoute('/login')({
  component: LoginPage,
})

function LoginPage() {
  const { isAuthenticated, isLoading } = useAuth()
  const { theme, toggleTheme } = useTheme()

  const [isRedirecting, setIsRedirecting] = useState(false)

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (isAuthenticated) {
    return <Navigate to="/" />
  }

  const handleGitHubLogin = () => {
    setIsRedirecting(true)
    window.location.href = '/auth/github'
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-b from-background to-muted p-4 relative">
      <Button
        onClick={toggleTheme}
        variant="ghost"
        className="absolute top-4 right-4 gap-2 text-muted-foreground"
        aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
      >
        {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        {theme === 'dark' ? 'Light Mode' : 'Dark Mode'}
      </Button>
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="flex items-center justify-center gap-3 mb-8">
          <GitBranch className="h-10 w-10 text-overlap-primary" />
          <span className="text-4xl font-bold">Overlap</span>
        </div>

        {/* Login Card */}
        <Card>
          <CardHeader className="text-center">
            <CardTitle className="text-2xl">Welcome to Overlap</CardTitle>
            <CardDescription>
              Detect overlapping file changes across your Git branches before they become merge conflicts
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <Button
              onClick={handleGitHubLogin}
              className="w-full h-12 text-base"
              size="lg"
              disabled={isRedirecting}
            >
              {isRedirecting ? (
                <Loader2 className="h-5 w-5 mr-2 animate-spin" />
              ) : (
                <Github className="h-5 w-5 mr-2" />
              )}
              {isRedirecting ? 'Redirecting to GitHub...' : 'Continue with GitHub'}
            </Button>

            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <span className="w-full border-t" />
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-card px-2 text-muted-foreground">
                  Why Overlap?
                </span>
              </div>
            </div>

            <div className="grid gap-4">
              <Feature
                icon={<Zap className="h-5 w-5 text-overlap-warning" />}
                title="Real-time Detection"
                description="Detect file overlaps as soon as changes are pushed"
              />
              <Feature
                icon={<Users className="h-5 w-5 text-overlap-primary" />}
                title="Team Coordination"
                description="Know when teammates are working on the same files"
              />
              <Feature
                icon={<Shield className="h-5 w-5 text-overlap-success" />}
                title="Prevent Conflicts"
                description="Resolve overlaps early, before painful merges"
              />
            </div>
          </CardContent>
        </Card>

        <p className="text-center text-sm text-muted-foreground mt-6">
          By continuing, you agree to grant Overlap read access to your repositories
        </p>
      </div>
    </div>
  )
}

function Feature({
  icon,
  title,
  description,
}: {
  icon: React.ReactNode
  title: string
  description: string
}) {
  return (
    <div className="flex items-start gap-3">
      <div className="flex-shrink-0 mt-0.5">{icon}</div>
      <div>
        <p className="font-medium text-sm">{title}</p>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
    </div>
  )
}
