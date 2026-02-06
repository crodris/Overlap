const BASE_URL = ''

class ApiError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const headers: Record<string, string> = { ...options?.headers as Record<string, string> }
  if (options?.body) {
    headers['Content-Type'] = 'application/json'
  }

  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    credentials: 'include',
    headers,
  })

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }))
    throw new ApiError(res.status, body.error || res.statusText)
  }

  return res.json() as Promise<T>
}

export const api = {
  // Auth
  getMe: () =>
    request<{
      user: {
        id: string
        githubId: number
        username: string
        email: string | null
        avatarUrl: string | null
      }
      hasInstallations: boolean
    }>('/auth/me'),

  logout: () => request<{ success: boolean }>('/auth/logout', { method: 'POST' }),

  // Repositories
  getRepositories: () =>
    request<
      Array<{
        id: string
        name: string
        fullName: string
        defaultBranch: string
        isPrivate: boolean
        activeBranches: number
        activeOverlaps: number
        lastSyncedAt: string | null
        settings: {
          id: string
          pruningDays: number
          ignoredPaths: string[]
          notifyOnNewOverlap: boolean
          notifyOnSeverityIncrease: boolean
        } | null
      }>
    >('/api/repositories'),

  getRepository: (id: string) =>
    request<{
      id: string
      name: string
      fullName: string
      defaultBranch: string
      isPrivate: boolean
      lastSyncedAt: string | null
      settings: {
        id: string
        pruningDays: number
        ignoredPaths: string[]
        notifyOnNewOverlap: boolean
        notifyOnSeverityIncrease: boolean
      } | null
    }>(`/api/repositories/${id}`),

  updateRepositorySettings: (id: string, data: Record<string, unknown>) =>
    request(`/api/repositories/${id}/settings`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),

  getBranches: (id: string, params?: Record<string, string>) => {
    const qs = params ? `?${new URLSearchParams(params)}` : ''
    return request<
      Array<{
        id: string
        name: string
        sha: string
        isDefault: boolean
        lastPusherGithubId: number | null
        lastSeenAt: string
      }>
    >(`/api/repositories/${id}/branches${qs}`)
  },

  getOverlaps: (id: string, params?: Record<string, string>) => {
    const qs = params ? `?${new URLSearchParams(params)}` : ''
    return request<
      Array<{
        id: string
        sourceBranch: { id: string; name: string; lastPusherGithubId: number | null }
        targetBranch: { id: string; name: string; lastPusherGithubId: number | null }
        fileCount: number
        severity: string
        status: string
        detectedAt: string
        files: Array<{ filePath: string }>
      }>
    >(`/api/repositories/${id}/overlaps${qs}`)
  },

  updateOverlap: (repoId: string, overlapId: string, data: { status: string }) =>
    request(`/api/repositories/${repoId}/overlaps/${overlapId}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),

  getCompareDiffs: (repoId: string, params: { base: string; head: string }) => {
    const qs = new URLSearchParams(params).toString()
    return request<{
      files: Array<{
        filename: string
        status: string
        additions: number
        deletions: number
        changes: number
        patch: string | null
        previousFilename?: string
      }>
    }>(`/api/repositories/${repoId}/diffs?${qs}`)
  },

  // Push notifications
  subscribePush: (subscription: { endpoint: string; keys: { p256dh: string; auth: string } }) =>
    request('/api/push/subscribe', {
      method: 'POST',
      body: JSON.stringify(subscription),
    }),

  unsubscribePush: (endpoint: string) =>
    request('/api/push/unsubscribe', {
      method: 'DELETE',
      body: JSON.stringify({ endpoint }),
    }),

  // DEV ONLY
  testNotify: (repoId: string, overlapId: string) =>
    request<{ success: boolean; message: string }>(
      `/api/repositories/${repoId}/overlaps/${overlapId}/test-notify`,
      { method: 'POST' }
    ),
}

export { ApiError }
