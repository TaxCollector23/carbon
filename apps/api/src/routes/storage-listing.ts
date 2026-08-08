import type { StorageObject } from '@carbon/storage';

/**
 * Consumes at most `limit` objects from a storage listing.
 *
 * `Storage.list` is an async iterable that paginates lazily — on S3 it keeps
 * issuing ListObjectsV2 calls until the prefix is exhausted. Every listing
 * endpoint therefore needs an explicit stop, or a project with a large history
 * turns a single GET into a multi-minute scan that buffers the whole result
 * set in memory.
 *
 * Returns the number of objects actually visited so the caller can report
 * whether the answer was truncated. Breaking out of a `for await` closes the
 * iterator via its `return()` method, so no pagination continues in the
 * background.
 */
export async function collectStorage(
  listing: AsyncIterable<StorageObject>,
  limit: number,
  visit: (obj: StorageObject) => void,
): Promise<number> {
  let seen = 0;
  for await (const obj of listing) {
    visit(obj);
    seen += 1;
    if (seen >= limit) break;
  }
  return seen;
}
