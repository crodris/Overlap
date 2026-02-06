import { Badge } from '~/components/ui/badge'
import { cn } from '~/lib/utils'

interface DiffViewerProps {
  filename: string
  status: string
  additions: number
  deletions: number
  patch: string | null
  previousFilename?: string
}

interface DiffLine {
  type: 'add' | 'remove' | 'context' | 'hunk'
  content: string
  oldLineNo: number | null
  newLineNo: number | null
}

function parsePatch(patch: string): DiffLine[] {
  const lines = patch.split('\n')
  const result: DiffLine[] = []
  let oldLine = 0
  let newLine = 0

  for (const line of lines) {
    if (line.startsWith('@@')) {
      const match = line.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/)
      if (match) {
        oldLine = parseInt(match[1], 10)
        newLine = parseInt(match[2], 10)
      }
      result.push({ type: 'hunk', content: line, oldLineNo: null, newLineNo: null })
    } else if (line.startsWith('+')) {
      result.push({ type: 'add', content: line.slice(1), oldLineNo: null, newLineNo: newLine })
      newLine++
    } else if (line.startsWith('-')) {
      result.push({ type: 'remove', content: line.slice(1), oldLineNo: oldLine, newLineNo: null })
      oldLine++
    } else {
      // Context line (starts with space or is empty)
      result.push({
        type: 'context',
        content: line.startsWith(' ') ? line.slice(1) : line,
        oldLineNo: oldLine,
        newLineNo: newLine,
      })
      oldLine++
      newLine++
    }
  }

  return result
}

const statusLabels: Record<string, string> = {
  added: 'Added',
  modified: 'Modified',
  removed: 'Deleted',
  renamed: 'Renamed',
  copied: 'Copied',
  changed: 'Changed',
}

export function DiffViewer({ filename, status, additions, deletions, patch, previousFilename }: DiffViewerProps) {
  const isBinary = !patch && additions === 0 && deletions === 0

  return (
    <div className="flex flex-col">
      {/* Header */}
      <div className="flex items-center gap-3 border-b px-4 py-3 bg-muted/50">
        <Badge variant="outline" className="text-xs shrink-0">
          {statusLabels[status] ?? status}
        </Badge>
        <code className="text-sm font-medium truncate">
          {previousFilename && previousFilename !== filename
            ? `${previousFilename} → ${filename}`
            : filename}
        </code>
        <div className="flex items-center gap-2 ml-auto text-xs shrink-0">
          {additions > 0 && <span className="text-diff-add-foreground font-medium">+{additions}</span>}
          {deletions > 0 && <span className="text-diff-remove-foreground font-medium">-{deletions}</span>}
        </div>
      </div>

      {/* Diff body */}
      <div className="max-h-96 overflow-y-auto">
        {isBinary ? (
          <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
            Binary file changed
          </div>
        ) : !patch ? (
          <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
            Diff too large to display
          </div>
        ) : (
          <table className="w-full border-collapse font-mono text-xs">
            <tbody>
              {parsePatch(patch).map((line, i) => (
                <tr
                  key={i}
                  className={cn(
                    line.type === 'add' && 'bg-diff-add',
                    line.type === 'remove' && 'bg-diff-remove',
                    line.type === 'hunk' && 'bg-diff-hunk'
                  )}
                >
                  {line.type === 'hunk' ? (
                    <td
                      colSpan={3}
                      className="px-3 py-1.5 text-diff-hunk-foreground select-none"
                    >
                      {line.content}
                    </td>
                  ) : (
                    <>
                      <td className="w-12 px-2 py-0.5 text-right text-muted-foreground select-none border-r border-border/50">
                        {line.oldLineNo ?? ''}
                      </td>
                      <td className="w-12 px-2 py-0.5 text-right text-muted-foreground select-none border-r border-border/50">
                        {line.newLineNo ?? ''}
                      </td>
                      <td
                        className={cn(
                          'px-3 py-0.5 whitespace-pre-wrap break-all',
                          line.type === 'add' && 'text-diff-add-foreground',
                          line.type === 'remove' && 'text-diff-remove-foreground'
                        )}
                      >
                        <span className="select-none mr-2 text-muted-foreground">
                          {line.type === 'add' ? '+' : line.type === 'remove' ? '-' : ' '}
                        </span>
                        {line.content}
                      </td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
