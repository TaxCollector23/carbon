/**
 * Well-known process exit codes for the Carbon CLI. Kept small and stable so
 * shell scripts and CI runners can branch on them without parsing stdout.
 *
 *   0  success
 *   1  generic failure (user error, validation)
 *   2  assertion failed (replay diff mismatch)
 *   3  connectivity error (couldn't reach the runtime / upstream)
 *   4  internal error (unexpected exception)
 */
export const EXIT_OK = 0;
export const EXIT_GENERIC = 1;
export const EXIT_ASSERTION_FAILED = 2;
export const EXIT_CONNECTIVITY = 3;
export const EXIT_INTERNAL = 4;
