export const ASSET_RETENTION_DAYS = 7
export const ASSET_CLEANUP_CONCURRENCY = 8

export function assetKey(userId: string, imageId: string): string {
  return `users/${userId}/images/${imageId}`
}

export async function mapWithConcurrency<T, TResult>(
  values: readonly T[],
  concurrency: number,
  operation: (value: T) => Promise<TResult>
): Promise<TResult[]> {
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new Error("Concurrency must be a positive integer")
  }

  const results = new Array<TResult>(values.length)
  let nextIndex = 0

  async function worker(): Promise<void> {
    while (nextIndex < values.length) {
      const index = nextIndex
      nextIndex += 1
      results[index] = await operation(values[index])
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, values.length) }, () => worker())
  )
  return results
}
