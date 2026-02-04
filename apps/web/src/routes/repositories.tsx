import { createFileRoute, Link } from '@tanstack/react-router'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { GitBranch, Lock, Globe, RefreshCw, ExternalLink } from 'lucide-react'

export const Route = createFileRoute('/repositories')({
  component: RepositoriesPage,
})

function RepositoriesPage() {
  // Mock data for demo - will be replaced with actual API calls
  const repositories = [
    {
      id: '1',
      name: 'frontend',
      fullName: 'acme/frontend',
      defaultBranch: 'main',
      isPrivate: true,
      activeBranches: 8,
      activeOverlaps: 3,
      lastSyncedAt: new Date(Date.now() - 1000 * 60 * 5), // 5 mins ago
    },
    {
      id: '2',
      name: 'backend',
      fullName: 'acme/backend',
      defaultBranch: 'main',
      isPrivate: true,
      activeBranches: 12,
      activeOverlaps: 4,
      lastSyncedAt: new Date(Date.now() - 1000 * 60 * 3), // 3 mins ago
    },
    {
      id: '3',
      name: 'shared-lib',
      fullName: 'acme/shared-lib',
      defaultBranch: 'main',
      isPrivate: false,
      activeBranches: 3,
      activeOverlaps: 0,
      lastSyncedAt: new Date(Date.now() - 1000 * 60 * 10), // 10 mins ago
    },
  ]

  return (
    <div className="p-8">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Repositories</h1>
          <p className="text-muted-foreground">
            Manage your connected GitHub repositories
          </p>
        </div>
        <Button>
          <RefreshCw className="h-4 w-4 mr-2" />
          Sync All
        </Button>
      </div>

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
                <div className="ml-auto text-sm text-muted-foreground">
                  Last synced: {formatRelativeTime(repo.lastSyncedAt)}
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
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
