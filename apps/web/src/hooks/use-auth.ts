import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api, ApiError } from '~/lib/api'
import { useRouter } from '@tanstack/react-router'

export function useAuth() {
  const queryClient = useQueryClient()
  const router = useRouter()

  const { data, isLoading, error } = useQuery({
    queryKey: ['auth', 'me'],
    queryFn: api.getMe,
    retry: false,
    staleTime: 5 * 60 * 1000, // 5 minutes
  })

  const isAuthenticated = !!data?.user
  const isUnauthorized = error instanceof ApiError && error.status === 401

  const logout = async () => {
    await api.logout()
    queryClient.clear()
    router.navigate({ to: '/login' })
  }

  return {
    user: data?.user ?? null,
    hasInstallations: data?.hasInstallations ?? false,
    isAuthenticated,
    isLoading: isLoading && !isUnauthorized,
    logout,
  }
}
