import { createFileRoute, Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { Skeleton } from '~/components/ui/skeleton'
import { GitBranch, Lock, Globe, ChevronRight, AlertTriangle } from 'lucide-react'
import { ProtectedRoute } from '~/components/protected-route'
import { api } from '~/lib/api'

export const Route = createFileRoute('/repositories')({
  component: RepositoriesPage,
})

function RepositoriesPage() {
  return (
    <ProtectedRoute>
      <RepositoriesContent />
    </ProtectedRoute>
  )
}

function RepositoriesContent() {
  const { data: repos, isLoading, isError } = useQuery({
    queryKey: ['repositories'],
    queryFn: api.getRepositories,
  })

  if (isLoading) {
    return (
      <div className="p-4 md:p-8">
        <div className="mb-8">
          <Skeleton className="h-9 w-48 mb-2" />
          <Skeleton className="h-5 w-72" />
        </div>
        <div className="grid gap-4">
          {[...Array(3)].map((_, i) => (
            <Card key={i}>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <div className="flex items-center gap-3">
                  <Skeleton className="h-5 w-5 rounded" />
                  <div>
                    <Skeleton className="h-6 w-48 mb-1" />
                    <Skeleton className="h-4 w-24" />
                  </div>
                </div>
                <Skeleton className="h-9 w-28 rounded-md" />
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-6">
                  <Skeleton className="h-8 w-32" />
                  <Skeleton className="h-6 w-24 rounded-full" />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    )
  }

  if (isError) {
    return (
      <div className="p-4 md:p-8">
        <Card>
          <CardContent className="py-12 text-center">
            <AlertTriangle className="h-12 w-12 mx-auto text-destructive mb-4" />
            <h3 className="text-lg font-medium mb-2">Failed to load repositories</h3>
            <p className="text-muted-foreground mb-4">Something went wrong. Please try again.</p>
            <Button onClick={() => window.location.reload()} variant="outline">Try Again</Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  const repositories = repos ?? []

  return (
    <div className="p-4 md:p-8">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Repositories</h1>
          <p className="text-muted-foreground">
            Manage your connected GitHub repositories
          </p>
        </div>
      </div>

      {repositories.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <GitBranch className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <h3 className="text-lg font-medium mb-2">No repositories</h3>
            <p className="text-muted-foreground mb-4">
              Repositories will appear once they're synced from your GitHub App installation.
            </p>
            <Button asChild variant="outline">
              <Link to="/settings">Go to Settings</Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4">
          {repositories.map((repo) => (
            <Card key={repo.id}>
              <CardHeader className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 sm:space-y-0 pb-2">
                <div className="flex items-center gap-3">
                  <GitBranch className="h-5 w-5 text-muted-foreground" />
                  <div>
                    <CardTitle className="text-lg flex items-center gap-2">
                      {repo.fullName}
                      {repo.isPrivate ? (
                        <Lock className="h-4 w-4 text-muted-foreground" />
                      ) : (
                        <Globe className="h-4 w-4 text-muted-foreground" />
                      )}
                    </CardTitle>
                    <CardDescription>Default: {repo.defaultBranch}</CardDescription>
                  </div>
                </div>
                <div className="flex items-center gap-2 w-full sm:w-auto">
                  <Button variant="outline" size="sm" asChild className="w-full sm:w-auto">
                    <Link to="/repositories/$repoId" params={{ repoId: repo.id }}>
                      View Details
                      <ChevronRight className="h-4 w-4 ml-2" />
                    </Link>
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-6">
                  <div className="flex items-center gap-2">
                    <span className="text-2xl font-bold">{repo.activeBranches}</span>
                    <span className="text-sm text-muted-foreground">active branches</span>
                  </div>
                  {repo.activeOverlaps > 0 ? (
                    <Badge variant="destructive">
                      {repo.activeOverlaps} {repo.activeOverlaps === 1 ? 'overlap' : 'overlaps'}
                    </Badge>
                  ) : (
                    <Badge variant="secondary">No overlaps</Badge>
                  )}
                  {repo.lastSyncedAt && (
                    <div className="ml-auto text-sm text-muted-foreground">
                      Last synced: {formatRelativeTime(new Date(repo.lastSyncedAt))}
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}

function formatRelativeTime(date: Date): string {
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMs / 3600000)
  const diffDays = Math.floor(diffMs / 86400000)

  if (diffMins < 1) return 'just now'
  if (diffMins < 60) return `${diffMins}m ago`
  if (diffHours < 24) return `${diffHours}h ago`
  return `${diffDays}d ago`
}
