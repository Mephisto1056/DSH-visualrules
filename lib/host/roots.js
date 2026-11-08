/**
 * Small process-local cache of repository facts per effective directory.
 *
 * Prompt assembly is synchronous, so the section provider cannot run `git`
 * itself. Agent creation and profile requests refresh this cache; the next
 * model step sees the result.
 */

const roots = new Map()
const branches = new Map()

export function rememberRepo(cwd, info) {
  if (!cwd) return
  if (info?.root) roots.set(cwd, info.root)
  if (info?.branch !== undefined) branches.set(cwd, info.branch || '')
}

export function repoRootOf(cwd) {
  return roots.get(cwd) ?? null
}

export function branchOf(cwd) {
  return branches.get(cwd) ?? ''
}

export function forgetRepo(cwd) {
  if (!cwd) {
    roots.clear()
    branches.clear()
    return
  }
  roots.delete(cwd)
  branches.delete(cwd)
}
