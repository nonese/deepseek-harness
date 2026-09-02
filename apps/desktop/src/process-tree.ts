/** Windows process-tree command construction for desktop runtime shutdown. */

/**
 * Build one taskkill invocation for the DSH runtime tree.
 *
 * @param pid - Positive root process identifier returned by Node spawn.
 * @param force - Whether to request forced termination after the grace period.
 * @returns Arguments for the Windows taskkill executable.
 */
export function windowsProcessTreeArguments(pid: number, force: boolean): readonly string[] {
  if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error('process tree pid must be a positive safe integer')
  return ['/PID', String(pid), '/T', ...(force ? ['/F'] : [])]
}
