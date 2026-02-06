import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api, ApiError } from '~/lib/api'

export function useAuth() {
  const queryClient = useQueryClient()

  const { data, isLoading, error } = useQuery({
    queryKey: ['auth', 'me'],
    queryFn: api.getMe,
    retry: false,
    staleTime: 5 * 60 * 1000, // 5 minutes
  })

  const isAuthenticated = !!data?.user
  const isUnauthorized = error instanceof ApiError && error.status === 401

  const logout = async () => {
    try {
      await api.logout()
    } finally {
      queryClient.clear()
      window.location.href = '/login'
    }
  }

  return {
    user: data?.user ?? null,
    hasInstallations: data?.hasInstallations ?? false,
    isAuthenticated,
    isLoading: isLoading && !isUnauthorized,
    logout,
  }
}
