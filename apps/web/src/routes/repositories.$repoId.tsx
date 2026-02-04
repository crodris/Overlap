import { createFileRoute, Link } from '@tanstack/react-router'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { ArrowLeft, GitBranch, RefreshCw, Settings, AlertTriangle, CheckCircle } from 'lucide-react'

export const Route = createFileRoute('/repositories/$repoId')({
  component: RepositoryDetailPage,
})

function RepositoryDetailPage() {
  const { repoId } = Route.useParams()

  // Mock data for demo
  const repo = {
    id: repoId,
    name: 'frontend',
    fullName: 'acme/frontend',
    defaultBranch: 'main',
    isPrivate: true,
    lastSyncedAt: new Date(Date.now() - 1000 * 60 * 5),
  }

  const branches = [
    { id: '1', name: 'feature/auth', sha: 'abc1234', fileCount: 12, overlappingBranches: 2, lastSeenAt: new Date() },
    { id: '2', name: 'feature/dashboard', sha: 'def5678', fileCount: 8, overlappingBranches: 1, lastSeenAt: new Date() },
    { id: '3', name: 'bugfix/login', sha: 'ghi9012', fileCount: 3, overlappingBranches: 1, lastSeenAt: new Date() },
    { id: '4', name: 'feature/api-v2', sha: 'jkl3456', fileCount: 15, overlappingBranches: 0, lastSeenAt: new Date() },
  ]

  const overlaps = [
    {
      id: '1',
      sourceBranch: { name: 'feature/auth' },
      targetBranch: { name: 'feature/dashboard' },
      fileCount: 4,
      severity: 'high' as const,
      status: 'active',
      files: ['src/components/Header.tsx', 'src/hooks/useAuth.ts', 'src/pages/Login.tsx', 'src/utils/auth.ts'],
    },
    {
      id: '2',
      sourceBranch: { name: 'feature/dashboard' },
      targetBranch: { name: 'bugfix/login' },
      fileCount: 2,
      severity: 'medium' as const,
      status: 'active',
      files: ['src/pages/Login.tsx', 'src/components/Form.tsx'],
    },
  ]

  return (
    <div className="p-8">
      {/* Header */}
      <div className="mb-8">
        <Link to="/repositories" className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground mb-4">
          <ArrowLeft className="h-4 w-4" />
          Back to repositories
        </Link>
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">{repo.fullName}</h1>
            <p className="text-muted-foreground">
              Default branch: {repo.defaultBranch}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline">
              <Settings className="h-4 w-4 mr-2" />
              Settings
            </Button>
            <Button>
              <RefreshCw className="h-4 w-4 mr-2" />
              Sync Now
            </Button>
          </div>
        </div>
      </div>

      <div className="grid gap-8 lg:grid-cols-2">
        {/* Branches */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <GitBranch className="h-5 w-5" />
              Active Branches
            </CardTitle>
            <CardDescription>
              Non-default branches with tracked file changes
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {branches.map((branch) => (
                <div
                  key={branch.id}
                  className="flex items-center justify-between rounded-lg border p-3"
                >
                  <div>
                    <code className="text-sm font-medium">{branch.name}</code>
                    <p className="text-xs text-muted-foreground">
                      {branch.fileCount} files changed
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {branch.overlappingBranches > 0 ? (
                      <Badge variant="destructive">
                        <AlertTriangle className="h-3 w-3 mr-1" />
                        {branch.overlappingBranches} overlaps
                      </Badge>
                    ) : (
                      <Badge variant="secondary">
                        <CheckCircle className="h-3 w-3 mr-1" />
                        No overlaps
                      </Badge>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Overlaps */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-overlap-warning" />
              Active Overlaps
            </CardTitle>
            <CardDescription>
              Detected file conflicts between branches
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {overlaps.map((overlap) => (
                <div
                  key={overlap.id}
                  className="rounded-lg border p-4 space-y-3"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <code className="text-sm bg-muted px-2 py-0.5 rounded">
                        {overlap.sourceBranch.name}
                      </code>
                      <span className="text-muted-foreground">&</span>
                      <code className="text-sm bg-muted px-2 py-0.5 rounded">
                        {overlap.targetBranch.name}
                      </code>
                    </div>
                    <Badge variant={overlap.severity}>{overlap.severity}</Badge>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground mb-2">
                      {overlap.fileCount} overlapping files:
                    </p>
                    <div className="space-y-1">
                      {overlap.files.slice(0, 3).map((file) => (
                        <code key={file} className="block text-xs text-muted-foreground">
                          {file}
                        </code>
                      ))}
                      {overlap.files.length > 3 && (
                        <p className="text-xs text-muted-foreground">
                          ... and {overlap.files.length - 3} more
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm">
                      View Details
                    </Button>
                    <Button variant="ghost" size="sm">
                      Mark Resolved
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
