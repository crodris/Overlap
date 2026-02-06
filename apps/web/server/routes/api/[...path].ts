import { defineEventHandler, proxyRequest } from 'h3'

export default defineEventHandler(async (event) => {
  const apiUrl = process.env.API_URL || 'http://localhost:3001'
  const path = event.context.params?.path || ''
  return proxyRequest(event, `${apiUrl}/api/${path}`)
})
