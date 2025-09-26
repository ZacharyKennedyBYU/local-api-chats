export const apiBase = () => {
  const url = new URL(window.location.href)
  return `${url.protocol}//${url.hostname}:3001`
}

export async function listProfiles() {
  const r = await fetch(`${apiBase()}/api/profiles`)
  return r.json()
}

export async function createProfile(input: { name: string; api_base_url: string; api_key: string; settings?: any }) {
  const r = await fetch(`${apiBase()}/api/profiles`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) })
  return r.json()
}

export async function listModels(profileId: number) {
  const r = await fetch(`${apiBase()}/api/profiles/${profileId}/models`)
  return r.json()
}

export async function sendChat(body: any) {
  const r = await fetch(`${apiBase()}/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  return r.json()
}

