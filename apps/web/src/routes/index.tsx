import { createFileRoute, Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card'
import { Badge } from '~/components/ui/badge'
import { GitBranch, AlertTriangle, GitPullRequest, Clock, Loader2 } from 'lucide-react'
import { ProtectedRoute } from '~/components/protected-route'
import { NotificationPrompt } from '~/components/notification-prompt'
import { api } from '~/lib/api'

export const Route = createFileRoute('/')({
  component: DashboardPage,
})

function DashboardPage() {
  return (
    <ProtectedRoute>
      <DashboardContent />
    </ProtectedRoute>
  )
}

function DashboardContent() {
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

  const stats = {
    repositories: repositories.length,
    activeBranches: repositories.reduce((sum, r) => sum + r.activeBranches, 0),
    activeOverlaps: repositories.reduce((sum, r) => sum + r.activeOverlaps, 0),
  }

  return (
    <div className="p-8">
      <NotificationPrompt />
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
        <p className="text-muted-foreground">
          Monitor branch overlaps across your repositories
        </p>
      </div>

      {/* Stats Grid */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 mb-8">
        <StatsCard
          title="Repositories"
          value={stats.repositories}
          description="Connected repositories"
          icon={<GitBranch className="h-4 w-4 text-muted-foreground" />}
        />
        <StatsCard
          title="Active Branches"
          value={stats.activeBranches}
          description="Non-default branches"
          icon={<GitPullRequest className="h-4 w-4 text-muted-foreground" />}
        />
        <StatsCard
          title="Active Overlaps"
          value={stats.activeOverlaps}
          description="Detected conflicts"
          icon={<AlertTriangle className="h-4 w-4 text-overlap-warning" />}
        />
      </div>

      {/* Repositories summary */}
      {repositories.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <GitBranch className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <h3 className="text-lg font-medium mb-2">No repositories yet</h3>
            <p className="text-muted-foreground">
              Repositories will appear here once they're synced from your GitHub App installation.
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Repositories</CardTitle>
            <CardDescription>
              Your connected repositories and their overlap status
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {repositories.map((repo) => (
                <Link
                  key={repo.id}
                  to="/repositories/$repoId"
                  params={{ repoId: repo.id }}
                  className="flex items-center justify-between rounded-lg border p-4 hover:bg-accent/50 transition-colors"
                >
                  <div className="space-y-1">
                    <p className="font-medium">{repo.fullName}</p>
                    <p className="text-sm text-muted-foreground">
                      {repo.activeBranches} branches
                    </p>
                  </div>
                  <div className="flex items-center gap-4">
                    {repo.activeOverlaps > 0 ? (
                      <Badge variant="destructive">
                        {repo.activeOverlaps} overlaps
                      </Badge>
                    ) : (
                      <Badge variant="secondary">No overlaps</Badge>
                    )}
                    {repo.lastSyncedAt && (
                      <span className="text-sm text-muted-foreground">
                        {formatRelativeTime(new Date(repo.lastSyncedAt))}
                      </span>
                    )}
                  </div>
                </Link>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

function StatsCard({
  title,
  value,
  description,
  icon,
}: {
  title: string
  value: number
  description: string
  icon: React.ReactNode
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        {icon}
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{value}</div>
        <p className="text-xs text-muted-foreground">{description}</p>
      </CardContent>
    </Card>
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
