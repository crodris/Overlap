# ship pipeline profile
verify: npx turbo typecheck lint test --force && pnpm test:integration && pnpm --filter @overlap/web build  # asked
base: main
release: none
post-merge: none
pr-hook: none
