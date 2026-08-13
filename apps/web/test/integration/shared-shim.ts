/**
 * A loadable copy of `@overlap/shared` for the generated step bundle.
 *
 * Unlike the `@overlap/db` and `@overlap/github` shims this substitutes no
 * behaviour at all - it re-exports the real module verbatim. It exists purely
 * because the workspace package ships TypeScript sources whose relative
 * imports carry `.js` extensions, which Node's own type stripping does not
 * rewrite back to `.ts`; bundling it with esbuild produces something Node can
 * import. The validation schemas, event constants and severity calculation the
 * steps depend on are therefore the production ones.
 */

export * from '@overlap/shared'
