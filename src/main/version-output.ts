/** First non-empty version output line, shared by the update checker. */
export function extractVersionLine(output: string): string | null {
  const line = output.trim().split('\n')[0]?.trim()
  return line ? line : null
}
