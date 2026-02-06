import { createFileRoute, Link } from '@tanstack/react-router'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { ArrowLeft, GitBranch, AlertTriangle, CheckCircle, Loader2 } from 'lucide-react'
import { ProtectedRoute } from '~/components/protected-route'
import { api } from '~/lib/api'

export const Route = createFileRoute('/repositories_/$repoId')({
  component: RepositoryDetailPage,
})

function RepositoryDetailPage() {
  return (
    <ProtectedRoute>
      <RepositoryDetailContent />
    </ProtectedRoute>
  )
}

function RepositoryDetailContent() {
  const { repoId } = Route.useParams()
  const queryClient = useQueryClient()

  const { data: repo, isLoading: repoLoading } = useQuery({
    queryKey: ['repository', repoId],
    queryFn: () => api.getRepository(repoId),
  })

  const { data: branchList } = useQuery({
    queryKey: ['branches', repoId],
    queryFn: () => api.getBranches(repoId),
    enabled: !!repo,
  })

  const { data: overlapList } = useQuery({
    queryKey: ['overlaps', repoId],
    queryFn: () => api.getOverlaps(repoId, { status: 'active' }),
    enabled: !!repo,
  })

  const updateOverlap = useMutation({
    mutationFn: ({ overlapId, status }: { overlapId: string; status: string }) =>
      api.updateOverlap(repoId, overlapId, { status }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['overlaps', repoId] })
      queryClient.invalidateQueries({ queryKey: ['repositories'] })
    },
  })

  if (repoLoading) {
    return (
      <div className="flex items-center justify-center p-16">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (!repo) {
    return (
      <div className="p-8">
        <p className="text-muted-foreground">Repository not found.</p>
      </div>
    )
  }

  const branches = branchList ?? []
  const overlaps = overlapList ?? []

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
            {branches.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">
                No active branches yet.
              </p>
            ) : (
              <div className="space-y-3">
                {branches.map((branch) => {
                  const branchOverlaps = overlaps.filter(
                    (o) => o.sourceBranch.id === branch.id || o.targetBranch.id === branch.id
                  )
                  return (
                    <div
                      key={branch.id}
                      className="flex items-center justify-between rounded-lg border p-3"
                    >
                      <div>
                        <code className="text-sm font-medium">{branch.name}</code>
                      </div>
                      <div className="flex items-center gap-2">
                        {branchOverlaps.length > 0 ? (
                          <Badge variant="destructive">
                            <AlertTriangle className="h-3 w-3 mr-1" />
                            {branchOverlaps.length} {branchOverlaps.length === 1 ? 'overlap' : 'overlaps'}
                          </Badge>
                        ) : (
                          <Badge variant="secondary">
                            <CheckCircle className="h-3 w-3 mr-1" />
                            No overlaps
                          </Badge>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
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
            {overlaps.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">
                No active overlaps.
              </p>
            ) : (
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
                        <span className="text-muted-foreground">&amp;</span>
                        <code className="text-sm bg-muted px-2 py-0.5 rounded">
                          {overlap.targetBranch.name}
                        </code>
                      </div>
                      <Badge variant={overlap.severity as 'low' | 'medium' | 'high' | 'critical'}>
                        {overlap.severity}
                      </Badge>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground mb-2">
                        {overlap.fileCount} overlapping files:
                      </p>
                      <div className="space-y-1">
                        {overlap.files.slice(0, 3).map((file) => (
                          <code key={file.filePath} className="block text-xs text-muted-foreground">
                            {file.filePath}
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
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          updateOverlap.mutate({ overlapId: overlap.id, status: 'resolved' })
                        }
                        disabled={updateOverlap.isPending}
                      >
                        Mark Resolved
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          updateOverlap.mutate({ overlapId: overlap.id, status: 'ignored' })
                        }
                        disabled={updateOverlap.isPending}
                      >
                        Ignore
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
