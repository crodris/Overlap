import { useState } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { DiffViewer } from '~/components/diff-viewer'
import { ArrowLeft, ArrowLeftRight, GitBranch, AlertTriangle, CheckCircle, Loader2, FileCode, X } from 'lucide-react'
import { ProtectedRoute } from '~/components/protected-route'
import { useAuth } from '~/hooks/use-auth'
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
  const { user } = useAuth()

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

  const userGithubId = user?.githubId ?? null

  const branches = [...(branchList ?? [])].sort((a, b) => {
    const aIsUser = a.lastPusherGithubId === userGithubId ? 1 : 0
    const bIsUser = b.lastPusherGithubId === userGithubId ? 1 : 0
    return bIsUser - aIsUser
  })
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

      <div className="space-y-8">
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
                  <OverlapCard
                    key={overlap.id}
                    overlap={overlap}
                    repoId={repoId}
                    defaultBranch={repo.defaultBranch}
                    userGithubId={userGithubId}
                    onResolve={() => updateOverlap.mutate({ overlapId: overlap.id, status: 'resolved' })}
                    onIgnore={() => updateOverlap.mutate({ overlapId: overlap.id, status: 'ignored' })}
                    isUpdating={updateOverlap.isPending}
                  />
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

interface OverlapCardProps {
  overlap: {
    id: string
    sourceBranch: { id: string; name: string; lastPusherGithubId: number | null }
    targetBranch: { id: string; name: string; lastPusherGithubId: number | null }
    fileCount: number
    severity: string
    files: Array<{ filePath: string }>
  }
  repoId: string
  defaultBranch: string
  userGithubId: number | null
  onResolve: () => void
  onIgnore: () => void
  isUpdating: boolean
}

function OverlapCard({ overlap, repoId, defaultBranch, userGithubId, onResolve, onIgnore, isUpdating }: OverlapCardProps) {
  const [selectedFile, setSelectedFile] = useState<string | null>(null)

  // Auto-orient: put the logged-in user's branch on the left
  const userOwnsTarget = userGithubId != null && overlap.targetBranch.lastPusherGithubId === userGithubId
  const userOwnsSource = userGithubId != null && overlap.sourceBranch.lastPusherGithubId === userGithubId
  const autoSwapped = userOwnsTarget && !userOwnsSource
  const [manualSwap, setManualSwap] = useState(false)
  const swapped = autoSwapped !== manualSwap // XOR: manual toggle flips the auto state

  const leftBranch = swapped ? overlap.targetBranch : overlap.sourceBranch
  const rightBranch = swapped ? overlap.sourceBranch : overlap.targetBranch

  const leftDiffs = useQuery({
    queryKey: ['compare-diffs', repoId, leftBranch.name, defaultBranch],
    queryFn: () =>
      api.getCompareDiffs(repoId, {
        base: defaultBranch,
        head: leftBranch.name,
      }),
    staleTime: 60_000,
  })

  const rightDiffs = useQuery({
    queryKey: ['compare-diffs', repoId, rightBranch.name, defaultBranch],
    queryFn: () =>
      api.getCompareDiffs(repoId, {
        base: defaultBranch,
        head: rightBranch.name,
      }),
    staleTime: 60_000,
  })

  const findDiff = (
    data: typeof leftDiffs.data,
    filePath: string
  ) => data?.files.find((f) => f.filename === filePath || f.previousFilename === filePath)

  const isLoading = leftDiffs.isLoading || rightDiffs.isLoading
  const error = leftDiffs.error || rightDiffs.error

  return (
    <div className="rounded-lg border p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <code className="text-sm bg-muted px-2 py-0.5 rounded">
            {leftBranch.name}
          </code>
          <button
            type="button"
            onClick={() => setManualSwap(!manualSwap)}
            className="text-muted-foreground hover:text-foreground transition-colors p-0.5 rounded"
            title="Swap branch positions"
          >
            <ArrowLeftRight className="h-3.5 w-3.5" />
          </button>
          <code className="text-sm bg-muted px-2 py-0.5 rounded">
            {rightBranch.name}
          </code>
        </div>
        <Badge variant={overlap.severity as 'low' | 'medium' | 'high' | 'critical'}>
          {overlap.severity}
        </Badge>
      </div>
      <div>
        <p className="text-sm text-muted-foreground mb-2">
          {overlap.fileCount} overlapping {overlap.fileCount === 1 ? 'file' : 'files'}:
        </p>
        <div className="max-h-48 overflow-y-auto space-y-0.5">
          {overlap.files.map((file) => (
            <button
              key={file.filePath}
              type="button"
              onClick={() => setSelectedFile(selectedFile === file.filePath ? null : file.filePath)}
              className={`flex items-center gap-1.5 w-full text-left px-1.5 py-1 rounded text-xs transition-colors ${
                selectedFile === file.filePath
                  ? 'bg-accent text-foreground'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted'
              }`}
            >
              <FileCode className="h-3 w-3 shrink-0" />
              <code className="truncate">{file.filePath}</code>
            </button>
          ))}
        </div>
      </div>

      {/* Inline diff panel — side by side */}
      {selectedFile && (
        <div className="rounded-lg border overflow-hidden">
          <div className="flex items-center justify-between bg-muted/50 px-3 py-2 border-b">
            <code className="text-xs font-medium truncate">{selectedFile}</code>
            <button
              type="button"
              onClick={() => setSelectedFile(null)}
              className="rounded-sm p-0.5 text-muted-foreground hover:text-foreground transition-colors"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : error ? (
            <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
              {(error as Error).message || 'Failed to load diffs'}
            </div>
          ) : (
            <div className="grid grid-cols-2 divide-x">
              <DiffPanel
                branchName={leftBranch.name}
                defaultBranch={defaultBranch}
                diff={findDiff(leftDiffs.data, selectedFile)}
              />
              <DiffPanel
                branchName={rightBranch.name}
                defaultBranch={defaultBranch}
                diff={findDiff(rightDiffs.data, selectedFile)}
              />
            </div>
          )}
        </div>
      )}

      <div className="flex gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={onResolve}
          disabled={isUpdating}
        >
          Mark Resolved
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={onIgnore}
          disabled={isUpdating}
        >
          Ignore
        </Button>
      </div>
    </div>
  )
}

function DiffPanel({
  branchName,
  defaultBranch,
  diff,
}: {
  branchName: string
  defaultBranch: string
  diff: { filename: string; status: string; additions: number; deletions: number; changes: number; patch: string | null; previousFilename?: string } | undefined
}) {
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-2 px-3 py-1.5 bg-muted/30 border-b">
        <code className="text-xs font-medium truncate">{branchName}</code>
        <span className="text-xs text-muted-foreground shrink-0">vs {defaultBranch}</span>
      </div>
      {diff ? (
        <DiffViewer
          filename={diff.filename}
          status={diff.status}
          additions={diff.additions}
          deletions={diff.deletions}
          patch={diff.patch}
          previousFilename={diff.previousFilename}
        />
      ) : (
        <div className="flex items-center justify-center py-12 text-xs text-muted-foreground">
          No changes to this file
        </div>
      )}
    </div>
  )
}
