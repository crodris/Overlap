import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card'
import { Button } from '~/components/ui/button'
import { Switch } from '~/components/ui/switch'
import { User, Bell, Shield, Loader2 } from 'lucide-react'
import { ProtectedRoute } from '~/components/protected-route'
import { useAuth } from '~/hooks/use-auth'
import { usePushNotifications } from '~/hooks/use-push-notifications'
import { api } from '~/lib/api'

export const Route = createFileRoute('/settings')({
  component: SettingsPage,
})

function SettingsPage() {
  return (
    <ProtectedRoute>
      <SettingsContent />
    </ProtectedRoute>
  )
}

function SettingsContent() {
  const { user } = useAuth()
  const { isSupported, isSubscribed, subscribe, unsubscribe } = usePushNotifications()
  const queryClient = useQueryClient()

  const { data: repos } = useQuery({
    queryKey: ['repositories'],
    queryFn: api.getRepositories,
  })

  const updateSettings = useMutation({
    mutationFn: ({ repoId, data }: { repoId: string; data: Record<string, unknown> }) =>
      api.updateRepositorySettings(repoId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['repositories'] })
    },
  })

  const repositories = repos ?? []

  return (
    <div className="p-8 max-w-3xl">
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight">Settings</h1>
        <p className="text-muted-foreground">
          Manage your account and notification preferences
        </p>
      </div>

      <div className="space-y-6">
        {/* Account */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <User className="h-5 w-5" />
              Account
            </CardTitle>
            <CardDescription>
              Your GitHub account information
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-4">
              {user?.avatarUrl ? (
                <img
                  src={user.avatarUrl}
                  alt={user.username}
                  className="h-16 w-16 rounded-full"
                />
              ) : (
                <div className="h-16 w-16 rounded-full bg-muted flex items-center justify-center">
                  <User className="h-8 w-8 text-muted-foreground" />
                </div>
              )}
              <div>
                <p className="font-medium">@{user?.username ?? 'unknown'}</p>
                <p className="text-sm text-muted-foreground">{user?.email ?? 'No email'}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Push Notifications */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Bell className="h-5 w-5" />
              Notifications
            </CardTitle>
            <CardDescription>
              Receive native browser notifications for overlap alerts
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {isSupported ? (
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium">Push notifications</p>
                  <p className="text-sm text-muted-foreground">
                    Get notified when overlaps are detected on your branches
                  </p>
                </div>
                <Switch
                  checked={isSubscribed}
                  onCheckedChange={(checked) => {
                    if (checked) subscribe()
                    else unsubscribe()
                  }}
                />
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                Push notifications are not supported in this browser.
              </p>
            )}
          </CardContent>
        </Card>

        {/* Per-repo settings */}
        {repositories.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Shield className="h-5 w-5" />
                Repository Settings
              </CardTitle>
              <CardDescription>
                Configure overlap detection per repository
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {repositories.map((repo) => (
                <RepoSettings
                  key={repo.id}
                  repo={repo}
                  onSave={(data) => updateSettings.mutate({ repoId: repo.id, data })}
                  isSaving={updateSettings.isPending}
                />
              ))}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  )
}

function RepoSettings({
  repo,
  onSave,
  isSaving,
}: {
  repo: {
    id: string
    fullName: string
    settings: {
      pruningDays: number
      ignoredPaths: string[]
      notifyOnNewOverlap: boolean
      notifyOnSeverityIncrease: boolean
    } | null
  }
  onSave: (data: Record<string, unknown>) => void
  isSaving: boolean
}) {
  const settings = repo.settings
  const [pruningDays, setPruningDays] = useState(settings?.pruningDays ?? 14)
  const [ignoredPaths, setIgnoredPaths] = useState(
    settings?.ignoredPaths?.join('\n') ?? ''
  )
  const [notifyNew, setNotifyNew] = useState(settings?.notifyOnNewOverlap ?? true)
  const [notifySeverity, setNotifySeverity] = useState(settings?.notifyOnSeverityIncrease ?? true)

  return (
    <div className="border rounded-lg p-4 space-y-4">
      <h4 className="font-medium">{repo.fullName}</h4>

      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium">Notify on new overlaps</p>
        </div>
        <Switch checked={notifyNew} onCheckedChange={setNotifyNew} />
      </div>

      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium">Notify on severity increase</p>
        </div>
        <Switch checked={notifySeverity} onCheckedChange={setNotifySeverity} />
      </div>

      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium">Branch pruning</p>
          <p className="text-xs text-muted-foreground">Remove inactive branches after</p>
        </div>
        <select
          className="rounded-md border bg-background px-3 py-2 text-sm"
          value={pruningDays}
          onChange={(e) => setPruningDays(Number(e.target.value))}
        >
          <option value={7}>7 days</option>
          <option value={14}>14 days</option>
          <option value={30}>30 days</option>
          <option value={60}>60 days</option>
        </select>
      </div>

      <div>
        <p className="text-sm font-medium mb-1">Ignored file patterns</p>
        <textarea
          className="w-full rounded-md border bg-background px-3 py-2 text-sm font-mono"
          rows={3}
          value={ignoredPaths}
          onChange={(e) => setIgnoredPaths(e.target.value)}
        />
      </div>

      <Button
        size="sm"
        disabled={isSaving}
        onClick={() =>
          onSave({
            pruningDays,
            ignoredPaths: ignoredPaths.split('\n').filter(Boolean),
            notifyOnNewOverlap: notifyNew,
            notifyOnSeverityIncrease: notifySeverity,
          })
        }
      >
        {isSaving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
        Save Settings
      </Button>
    </div>
  )
}
