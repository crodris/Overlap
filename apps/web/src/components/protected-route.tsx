import { Navigate } from '@tanstack/react-router'
import { useAuth } from '~/hooks/use-auth'
import { Button } from '~/components/ui/button'
import { GitBranch, Loader2 } from 'lucide-react'

const GITHUB_APP_SLUG = import.meta.env.VITE_GITHUB_APP_SLUG || 'overlap-connector'
const INSTALL_URL = `https://github.com/apps/${GITHUB_APP_SLUG}/installations/new`

export function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading, hasInstallations } = useAuth()

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" />
  }

  if (!hasInstallations) {
    // Check if we've already redirected once this session
    const alreadyRedirected = sessionStorage.getItem('overlap_install_redirected')

    if (!alreadyRedirected) {
      sessionStorage.setItem('overlap_install_redirected', '1')
      window.location.href = INSTALL_URL
      return (
        <div className="flex min-h-screen items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      )
    }

    // Already redirected once - show CTA
    return (
      <div className="flex min-h-screen items-center justify-center p-8">
        <div className="text-center max-w-md space-y-4">
          <GitBranch className="h-12 w-12 text-overlap-primary mx-auto" />
          <h2 className="text-2xl font-bold">Install the GitHub App</h2>
          <p className="text-muted-foreground">
            Overlap needs access to your repositories to detect branch conflicts. Install the GitHub App to get started.
          </p>
          <Button asChild size="lg">
            <a href={INSTALL_URL}>Install GitHub App</a>
          </Button>
        </div>
      </div>
    )
  }

  return <>{children}</>
}
