import { createFileRoute, Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { GitBranch, Lock, Globe, ExternalLink, Loader2 } from 'lucide-react'
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
  const { data: repos, isLoading } = useQuery({
    queryKey: ['repositories'],
    queryFn: api.getRepositories,
  })

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-16">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  const repositories = repos ?? []

  return (
    <div className="p-8">
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
            <p className="text-muted-foreground">
              Repositories will appear once they're synced from your GitHub App installation.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4">
          {repositories.map((repo) => (
            <Card key={repo.id}>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
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
                <div className="flex items-center gap-2">
                  <Link to="/repositories/$repoId" params={{ repoId: repo.id }}>
                    <Button variant="outline" size="sm">
                      View Details
                      <ExternalLink className="h-4 w-4 ml-2" />
                    </Button>
                  </Link>
                </div>
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-6">
                  <div className="flex items-center gap-2">
                    <span className="text-2xl font-bold">{repo.activeBranches}</span>
                    <span className="text-sm text-muted-foreground">active branches</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-2xl font-bold">{repo.activeOverlaps}</span>
                    <span className="text-sm text-muted-foreground">overlaps</span>
                    {repo.activeOverlaps > 0 && (
                      <Badge variant="destructive">{repo.activeOverlaps}</Badge>
                    )}
                  </div>
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
