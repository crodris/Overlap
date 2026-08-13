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
 * load and every step dispatch hangs.
 *
 * This runs as a Vitest `setupFile`, which is the first point after the
 * plugin's own global setup has written the bundles and before any test can
 * trigger the lazy `import()` of them. The rewrite is idempotent and the file
 * is replaced by rename, so concurrent workers cannot observe a partial write.
 *
 * Delete this file once the SDK emits the attribute itself.
 */

import { readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const JSON_IMPORT =
  /(\bimport\s+[^;'"]*?\bfrom\s*)(["'])([^"']+\.json)\2(\s*;)/g

const here = dirname(fileURLToPath(import.meta.url))
const outDir = join(resolve(here, '../..'), '.workflow-vitest')

async function addJsonImportAttributes(file: string): Promise<void> {
  let source: string
  try {
    source = await readFile(file, 'utf8')
  } catch {
    return
  }

  const patched = source.replace(
    JSON_IMPORT,
    (match, head, quote, specifier, tail) =>
      match.includes('with {')
        ? match
        : `${head}${quote}${specifier}${quote} with { type: "json" }${tail}`
  )

  if (patched === source) return

  const temporary = `${file}.${process.pid}.tmp`
  await writeFile(temporary, patched)
  await rename(temporary, file)
}

await addJsonImportAttributes(join(outDir, 'steps.mjs'))
await addJsonImportAttributes(join(outDir, 'workflows.mjs'))
