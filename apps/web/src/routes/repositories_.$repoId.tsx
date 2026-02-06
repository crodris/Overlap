import { useState } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { DiffViewer } from '~/components/diff-viewer'
import { ArrowLeft, GitBranch, AlertTriangle, CheckCircle, Loader2, FileCode, X } from 'lucide-react'
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
    sourceBranch: { id: string; name: string }
    targetBranch: { id: string; name: string }
    fileCount: number
    severity: string
    files: Array<{ filePath: string }>
  }
  repoId: string
  defaultBranch: string
  onResolve: () => void
  onIgnore: () => void
  isUpdating: boolean
}

function OverlapCard({ overlap, repoId, defaultBranch, onResolve, onIgnore, isUpdating }: OverlapCardProps) {
  const [selectedFile, setSelectedFile] = useState<string | null>(null)

  const sourceDiffs = useQuery({
    queryKey: ['compare-diffs', repoId, overlap.sourceBranch.name, defaultBranch],
    queryFn: () =>
      api.getCompareDiffs(repoId, {
        base: defaultBranch,
        head: overlap.sourceBranch.name,
      }),
    staleTime: 60_000,
  })

  const targetDiffs = useQuery({
    queryKey: ['compare-diffs', repoId, overlap.targetBranch.name, defaultBranch],
    queryFn: () =>
      api.getCompareDiffs(repoId, {
        base: defaultBranch,
        head: overlap.targetBranch.name,
      }),
    staleTime: 60_000,
  })

  const findDiff = (
    data: typeof sourceDiffs.data,
    filePath: string
  ) => data?.files.find((f) => f.filename === filePath || f.previousFilename === filePath)

  const isLoading = sourceDiffs.isLoading || targetDiffs.isLoading
  const error = sourceDiffs.error || targetDiffs.error

  return (
    <div className="rounded-lg border p-4 space-y-3">
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
                branchName={overlap.sourceBranch.name}
                defaultBranch={defaultBranch}
                diff={findDiff(sourceDiffs.data, selectedFile)}
              />
              <DiffPanel
                branchName={overlap.targetBranch.name}
                defaultBranch={defaultBranch}
                diff={findDiff(targetDiffs.data, selectedFile)}
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
