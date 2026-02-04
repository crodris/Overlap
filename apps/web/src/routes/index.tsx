import { createFileRoute } from '@tanstack/react-router'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card'
import { Badge } from '~/components/ui/badge'
import { GitBranch, AlertTriangle, GitPullRequest, Clock } from 'lucide-react'

export const Route = createFileRoute('/')({
  component: DashboardPage,
})

function DashboardPage() {
  // Mock data for demo - will be replaced with actual API calls
  const stats = {
    repositories: 5,
    activeBranches: 23,
    activeOverlaps: 7,
    recentAlerts: 3,
  }

  const recentOverlaps = [
    {
      id: '1',
      repository: 'acme/frontend',
      sourceBranch: 'feature/auth',
      targetBranch: 'feature/dashboard',
      fileCount: 4,
      severity: 'high' as const,
      detectedAt: new Date(Date.now() - 1000 * 60 * 30), // 30 mins ago
    },
    {
      id: '2',
      repository: 'acme/frontend',
      sourceBranch: 'feature/api-v2',
      targetBranch: 'bugfix/login',
      fileCount: 2,
      severity: 'medium' as const,
      detectedAt: new Date(Date.now() - 1000 * 60 * 60 * 2), // 2 hours ago
    },
    {
      id: '3',
      repository: 'acme/backend',
      sourceBranch: 'feature/payments',
      targetBranch: 'feature/subscriptions',
      fileCount: 8,
      severity: 'critical' as const,
      detectedAt: new Date(Date.now() - 1000 * 60 * 60 * 5), // 5 hours ago
    },
  ]

  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
        <p className="text-muted-foreground">
          Monitor branch overlaps across your repositories
        </p>
      </div>

      {/* Stats Grid */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4 mb-8">
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
        <StatsCard
          title="Recent Alerts"
          value={stats.recentAlerts}
          description="Last 24 hours"
          icon={<Clock className="h-4 w-4 text-muted-foreground" />}
        />
      </div>

      {/* Recent Overlaps */}
      <Card>
        <CardHeader>
          <CardTitle>Recent Overlaps</CardTitle>
          <CardDescription>
            Latest detected file overlaps between branches
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {recentOverlaps.map((overlap) => (
              <div
                key={overlap.id}
                className="flex items-center justify-between rounded-lg border p-4"
              >
                <div className="space-y-1">
                  <p className="text-sm font-medium text-muted-foreground">
                    {overlap.repository}
                  </p>
                  <div className="flex items-center gap-2">
                    <code className="rounded bg-muted px-2 py-0.5 text-sm">
                      {overlap.sourceBranch}
                    </code>
                    <span className="text-muted-foreground">&</span>
                    <code className="rounded bg-muted px-2 py-0.5 text-sm">
                      {overlap.targetBranch}
                    </code>
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <span className="text-sm text-muted-foreground">
                    {overlap.fileCount} files
                  </span>
                  <Badge variant={overlap.severity}>{overlap.severity}</Badge>
                  <span className="text-sm text-muted-foreground">
                    {formatRelativeTime(overlap.detectedAt)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
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
