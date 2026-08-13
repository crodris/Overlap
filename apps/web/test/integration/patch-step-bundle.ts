/**
 * Works around a codegen bug in `@workflow/vitest` 4.0.18.
 *
 * The generated step bundle externalizes package imports rather than inlining
 * them, and one of the SDK's own internals (`@workflow/builders`' serde
 * checker) imports `builtin-modules`, whose package entry point is a `.json`
 * file. The externalized import comes out as
 *
 *   import builtinModules from ".../builtin-modules.json";
 *
 * with no import attribute, which every Node release that supports JSON
 * modules rejects with ERR_IMPORT_ATTRIBUTE_MISSING. The bundle then fails to
 * load, and because the local world swallows the error as
 * `[local world] Queue operation failed`, the only symptom is that every test
 * times out after 60 seconds with no indication of the cause.
 *
 * This runs as a Vitest `setupFile`, which is the first point after the
 * plugin's own global setup has written the bundles and before any test can
 * trigger the lazy `import()` of them. The rewrite is idempotent and the file
 * is replaced by rename, so concurrent workers cannot observe a partial write.
 *
 * It throws rather than no-oping when the bundle does not look the way it
 * expects, so that an SDK upgrade produces an immediate, readable failure
 * instead of reintroducing the silent 60-second timeout - in either direction:
 * a bundle that is missing, or one that no longer contains the bad import
 * (which is the signal that this file has done its job and should go).
 *
 * DELETE THIS FILE once `@workflow/vitest` emits the import attribute itself.
 * `expectations` below records exactly what has to change for that to be safe.
 */

import { readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Extension-less imports are fine; only `.json` needs the attribute. */
const JSON_IMPORT =
  /(\bimport\s+[^;'"]*?\bfrom\s*)(["'])([^"']+\.json)\2(\s*;)/g

const here = dirname(fileURLToPath(import.meta.url))
const webRoot = resolve(here, '../..')
const outDir = join(webRoot, '.workflow-vitest')

/**
 * Bundles that must exist, and whether each is known to carry the bad import.
 * `steps.mjs` is the one that does; `workflows.mjs` is checked opportunistically
 * in case a future version moves the serde checker into it.
 */
const expectations = [
  { file: 'steps.mjs', mustContainJsonImport: true },
  { file: 'workflows.mjs', mustContainJsonImport: false },
]

async function installedVersion(): Promise<string> {
  try {
    const manifest = await readFile(
      join(webRoot, 'node_modules', '@workflow', 'vitest', 'package.json'),
      'utf8'
    )
    return (JSON.parse(manifest) as { version?: string }).version ?? 'unknown'
  } catch {
    return 'unknown'
  }
}

async function fail(summary: string, detail: string): Promise<never> {
  throw new Error(
    [
      `patch-step-bundle: ${summary}`,
      '',
      detail,
      '',
      `Installed @workflow/vitest: ${await installedVersion()}`,
      `Bundle directory: ${relative(webRoot, outDir)}`,
      `Expected import pattern: ${JSON_IMPORT.source}`,
      '',
      'This file exists only to add `with { type: "json" }` to a JSON import',
      'that @workflow/vitest 4.0.18 emits without one. If the SDK has been',
      'upgraded and now emits the attribute itself, delete',
      'apps/web/test/integration/patch-step-bundle.ts and remove it from',
      "vitest.integration.config.ts's setupFiles. If the SDK changed in some",
      'other way, update this file to match.',
    ].join('\n')
  )
}

async function patchBundle(
  fileName: string,
  mustContainJsonImport: boolean
): Promise<void> {
  const file = join(outDir, fileName)

  let source: string
  try {
    source = await readFile(file, 'utf8')
  } catch (error) {
    return fail(
      `expected bundle ${fileName} does not exist`,
      `Reading it failed with: ${(error as Error).message}\n` +
        "The workflow plugin's global setup is supposed to have written it " +
        'before setup files run.'
    )
  }

  const alreadyPatched = /\.json["']\s+with\s*\{\s*type:\s*["']json["']\s*\}/.test(
    source
  )
  const matches = source.match(JSON_IMPORT) ?? []

  if (matches.length === 0) {
    if (alreadyPatched) return // A previous worker got there first.
    if (mustContainJsonImport) {
      return fail(
        `${fileName} no longer contains the unattributed JSON import this patch targets`,
        'Either the SDK now emits `with { type: "json" }` itself - in which ' +
          'case this file is obsolete and should be deleted - or it inlines ' +
          'the JSON instead of externalizing it, in which case the patch is ' +
          'no longer needed either. Verify by loading the bundle, then remove ' +
          'this file.'
      )
    }
    return
  }

  const patched = source.replace(
    JSON_IMPORT,
    (_match, head, quote, specifier, tail) =>
      `${head}${quote}${specifier}${quote} with { type: "json" }${tail}`
  )

  if (patched === source) {
    return fail(
      `${fileName} contains a JSON import that could not be rewritten`,
      `Matched ${matches.length} import(s) but the rewrite produced no change:\n` +
        matches.map((match) => `  ${match}`).join('\n')
    )
  }

  const temporary = `${file}.${process.pid}.tmp`
  await writeFile(temporary, patched)
  await rename(temporary, file)
}

for (const { file, mustContainJsonImport } of expectations) {
  await patchBundle(file, mustContainJsonImport)
}
