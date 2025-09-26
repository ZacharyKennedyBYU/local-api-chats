import React, { useEffect, useMemo, useRef, useState } from 'react'
import SettingsModal from './components/SettingsModal'

type Profile = {
  id: number
  name: string
  api_base_url: string
  settings: Record<string, any>
}

type ChatMessage = {
  id?: number
  role: 'system' | 'user' | 'assistant'
  content?: string
  parts?: Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }>
}

const API_BASE = () => {
  const url = new URL(window.location.href)
  // server runs on 3001 by default
  return `${url.protocol}//${url.hostname}:3001`
}

export default function App() {
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [activeProfileId, setActiveProfileId] = useState<number | null>(null)
  const [models, setModels] = useState<any[]>([])
  const [conversationId, setConversationId] = useState<number | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [imageDataUrl, setImageDataUrl] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [profileSettings, setProfileSettings] = useState<any>({})

  useEffect(() => {
    fetch(`${API_BASE()}/api/profiles`).then(r => r.json()).then(setProfiles)
  }, [])

  useEffect(() => {
    if (activeProfileId) {
      fetch(`${API_BASE()}/api/profiles/${activeProfileId}/models`).then(r => r.json()).then(setModels)
    }
  }, [activeProfileId])

  const activeProfile = useMemo(() => profiles.find(p => p.id === activeProfileId) || null, [profiles, activeProfileId])

  async function handleSend() {
    if (!activeProfileId) return
    const outgoing: ChatMessage = { role: 'user', content: input }
    const parts = imageDataUrl ? [{ type: 'image_url' as const, image_url: { url: imageDataUrl } }] : []
    if (parts.length) outgoing.parts = parts
    setMessages(prev => [...prev, outgoing])
    setInput('')
    setImageDataUrl(null)

    const resp = await fetch(`${API_BASE()}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        profileId: activeProfileId,
        conversationId: conversationId ?? undefined,
        model: undefined,
        messages: [...messages, outgoing].map(m => ({ role: m.role, content: m.content, parts: m.parts })),
        params: profileSettings || {}
      })
    })
    const data = await resp.json()
    setConversationId(data.conversationId)
    const assistant = data?.response?.choices?.[0]?.message?.content
    setMessages(prev => [...prev, { role: 'assistant', content: typeof assistant === 'string' ? assistant : '' }])
  }

  function handleUploadChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      setImageDataUrl(String(reader.result))
    }
    reader.readAsDataURL(file)
  }

  return (
    <div className="flex h-full bg-neutral-50 text-neutral-900">
      <aside className="w-64 border-r bg-white p-3 flex flex-col gap-2">
        <div className="flex items-center justify-between mb-2">
          <h1 className="font-semibold">Profiles</h1>
          <button className="text-sm px-2 py-1 rounded bg-neutral-200" onClick={() => {
            const name = prompt('Profile name?') || 'New Profile'
            const api_base_url = prompt('API Base URL (e.g. https://api.openai.com)') || ''
            const api_key = prompt('API Key?') || ''
            fetch(`${API_BASE()}/api/profiles`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, api_base_url, api_key }) })
              .then(r => r.json())
              .then(() => fetch(`${API_BASE()}/api/profiles`).then(r => r.json()).then(setProfiles))
          }}>Add</button>
        </div>
        <div className="flex flex-col gap-1">
          {profiles.map(p => (
            <button key={p.id} onClick={() => setActiveProfileId(p.id)} className={`text-left px-2 py-1 rounded ${activeProfileId === p.id ? 'bg-neutral-200' : 'hover:bg-neutral-100'}`}>
              <div className="font-medium">{p.name}</div>
              <div className="text-xs text-neutral-500 truncate">{p.api_base_url}</div>
            </button>
          ))}
        </div>
      </aside>
      <main className="flex-1 grid grid-rows-[auto_1fr_auto]">
        <header className="border-b bg-white p-3 flex items-center gap-3">
          <div className="font-semibold">{activeProfile?.name || 'Select a profile'}</div>
          <div className="ml-auto flex items-center gap-2 text-sm">
            <select className="border rounded px-2 py-1 bg-white">
              <option value="">Model (auto)</option>
              {models.map((m, idx) => (
                <option key={idx} value={m.id || m.name || String(m)}>{m.id || m.name || String(m)}</option>
              ))}
            </select>
            <button className="px-2 py-1 rounded bg-neutral-200" onClick={() => setSettingsOpen(true)}>Settings</button>
          </div>
        </header>
        <section className="overflow-y-auto p-4 space-y-4">
          {messages.map((m, idx) => (
            <div key={idx} className="flex gap-3">
              <div className={`shrink-0 w-8 h-8 rounded-full flex items-center justify-center ${m.role === 'assistant' ? 'bg-blue-600 text-white' : 'bg-neutral-300'}`}>{m.role[0].toUpperCase()}</div>
              <div className="prose max-w-3xl">
                {m.content && <p>{m.content}</p>}
                {m.parts?.filter(p => p.type === 'image_url').map((p, i) => (
                  <img key={i} src={(p as any).image_url.url} alt="uploaded" className="rounded border max-w-sm" />
                ))}
              </div>
            </div>
          ))}
        </section>
        <footer className="border-t bg-white p-3">
          <div className="max-w-3xl mx-auto">
            <div className="flex items-end gap-2">
              <div className="flex-1 relative">
                <textarea value={input} onChange={e => setInput(e.target.value)} className="w-full resize-none rounded border p-3 pr-24" rows={3} placeholder="Message..." />
                <div className="absolute right-2 bottom-2 flex items-center gap-2">
                  <input ref={fileInputRef} type="file" accept="image/*" onChange={handleUploadChange} className="hidden" />
                  <button className="px-2 py-1 text-sm rounded bg-neutral-200" onClick={() => fileInputRef.current?.click()}>Upload</button>
                  <button className="px-3 py-1 rounded bg-blue-600 text-white" onClick={handleSend}>Send</button>
                </div>
              </div>
            </div>
            {imageDataUrl && (
              <div className="mt-2 text-sm text-neutral-600 flex items-center gap-2">
                <img src={imageDataUrl} className="h-10 w-10 object-cover rounded border" />
                <span>Image attached</span>
                <button className="underline" onClick={() => setImageDataUrl(null)}>remove</button>
              </div>
            )}
          </div>
        </footer>
      </main>
      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} initial={profileSettings} onSave={(s) => { setProfileSettings(s); setSettingsOpen(false) }} />
    </div>
  )
}
