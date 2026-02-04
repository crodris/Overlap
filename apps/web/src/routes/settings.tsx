import { createFileRoute } from '@tanstack/react-router'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card'
import { Button } from '~/components/ui/button'
import { Switch } from '~/components/ui/switch'
import { User, Bell, Shield, Trash2 } from 'lucide-react'

export const Route = createFileRoute('/settings')({
  component: SettingsPage,
})

function SettingsPage() {
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
              <div className="h-16 w-16 rounded-full bg-muted flex items-center justify-center">
                <User className="h-8 w-8 text-muted-foreground" />
              </div>
              <div>
                <p className="font-medium">@username</p>
                <p className="text-sm text-muted-foreground">user@example.com</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Notifications */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Bell className="h-5 w-5" />
              Notifications
            </CardTitle>
            <CardDescription>
              Configure how you receive alerts
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <SettingRow
              title="New overlap detection"
              description="Get notified when new overlaps are detected"
              defaultChecked={true}
            />
            <SettingRow
              title="Severity increases"
              description="Get notified when overlap severity increases"
              defaultChecked={true}
            />
            <SettingRow
              title="PR comments"
              description="Post comments on pull requests with overlaps"
              defaultChecked={true}
            />
            <SettingRow
              title="Check runs"
              description="Create GitHub check runs for overlap status"
              defaultChecked={true}
            />
          </CardContent>
        </Card>

        {/* Default Repository Settings */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Shield className="h-5 w-5" />
              Default Repository Settings
            </CardTitle>
            <CardDescription>
              Default settings applied to new repositories
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium">Branch pruning</p>
                <p className="text-sm text-muted-foreground">
                  Remove inactive branches after this many days
                </p>
              </div>
              <select className="rounded-md border bg-background px-3 py-2 text-sm">
                <option value="7">7 days</option>
                <option value="14" selected>14 days</option>
                <option value="30">30 days</option>
                <option value="60">60 days</option>
              </select>
            </div>
            <div>
              <p className="font-medium mb-2">Ignored file patterns</p>
              <p className="text-sm text-muted-foreground mb-2">
                Files matching these patterns will be excluded from overlap detection
              </p>
              <textarea
                className="w-full rounded-md border bg-background px-3 py-2 text-sm font-mono"
                rows={4}
                defaultValue={`package-lock.json
pnpm-lock.yaml
yarn.lock
*.min.js
*.min.css
dist/**
build/**`}
              />
            </div>
          </CardContent>
        </Card>

        {/* Danger Zone */}
        <Card className="border-destructive">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-destructive">
              <Trash2 className="h-5 w-5" />
              Danger Zone
            </CardTitle>
            <CardDescription>
              Irreversible actions
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium">Disconnect GitHub App</p>
                <p className="text-sm text-muted-foreground">
                  Remove the GitHub App installation and delete all data
                </p>
              </div>
              <Button variant="destructive">Disconnect</Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

function SettingRow({
  title,
  description,
  defaultChecked,
}: {
  title: string
  description: string
  defaultChecked: boolean
}) {
  return (
    <div className="flex items-center justify-between">
      <div>
        <p className="font-medium">{title}</p>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      <Switch defaultChecked={defaultChecked} />
    </div>
  )
}
