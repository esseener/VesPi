/** GitHub's public latest-release redirect remains available when the API is rate limited. */
export async function latestKernelRelease(repository, request = fetch) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository)) throw new Error('Invalid kernel repository')
  const token = (process.env.GITHUB_TOKEN || process.env.GH_TOKEN || '').trim()
  const headers = { accept: 'application/vnd.github+json', 'user-agent': 'VesPi-packaging' }
  if (token) headers.authorization = `Bearer ${token}`
  const api = await request(`https://api.github.com/repos/${repository}/releases/latest`, {
    headers, signal: AbortSignal.timeout(20_000),
  })
  if (api.ok) return api.json()
  if (api.status !== 403 && api.status !== 429) throw new Error(`GitHub API ${api.status}`)
  await api.body?.cancel()
  const response = await request(`https://github.com/${repository}/releases/latest`, {
    method: 'HEAD', redirect: 'manual', signal: AbortSignal.timeout(20_000),
  })
  const location = response.headers.get('location') ?? ''
  const prefix = `https://github.com/${repository}/releases/tag/`
  if (![301, 302, 303, 307, 308].includes(response.status) || !location.startsWith(prefix)) {
    throw new Error('GitHub latest-release redirect unavailable')
  }
  const tag = location.slice(prefix.length)
  if (!/^v?\d+\.\d+\.\d+$/.test(tag)) throw new Error('Invalid latest kernel release tag')
  return {
    tag_name: tag,
    published_at: null,
    assets: [{
      name: 'SHA256SUMS.txt',
      browser_download_url: `https://github.com/${repository}/releases/download/${tag}/SHA256SUMS.txt`,
    }],
  }
}
