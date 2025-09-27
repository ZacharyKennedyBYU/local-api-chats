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

type Conversation = {
  id: number
  profile_id: number
  title: string | null
  model: string | null
  updated_at: string
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
  const [debugLogs, setDebugLogs] = useState<string[]>([])
  const [selectedModel, setSelectedModel] = useState<string>('')
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [editingMessageId, setEditingMessageId] = useState<number | null>(null)
  const [editingContent, setEditingContent] = useState<string>('')

  useEffect(() => {
    fetch(`${API_BASE()}/api/profiles`).then(r => r.json()).then(setProfiles)
    fetch(`${API_BASE()}/api/conversations`).then(r => r.json()).then(setConversations)
  }, [])

  useEffect(() => {
    if (!activeProfileId) return
    let isCancelled = false
    async function loadModels() {
      try {
        const resp = await fetch(`${API_BASE()}/api/profiles/${activeProfileId}/models`)
        if (!resp.ok) {
          // Ensure state remains an array on errors
          try { await resp.text() } catch {}
          if (!isCancelled) setModels([])
          return
        }
        const data = await resp.json().catch(() => [])
        const normalized = Array.isArray(data) ? data : Array.isArray((data as any)?.data) ? (data as any).data : []
        if (!isCancelled) setModels(normalized)
      } catch {
        if (!isCancelled) setModels([])
      }
    }
    loadModels()
    setSelectedModel('')
    return () => { isCancelled = true }
  }, [activeProfileId])

  useEffect(() => {
    if (!selectedModel && Array.isArray(models) && models.length > 0) {
      const first = models[0]
      setSelectedModel(first?.id || first?.name || String(first))
    }
  }, [models, selectedModel])

  const activeProfile = useMemo(() => profiles.find(p => p.id === activeProfileId) || null, [profiles, activeProfileId])

  async function refreshConversations() {
    const rows = await fetch(`${API_BASE()}/api/conversations`).then(r => r.json()).catch(() => [])
    if (Array.isArray(rows)) setConversations(rows)
  }

  async function loadConversation(id: number) {
    try {
      const r = await fetch(`${API_BASE()}/api/conversations/${id}/messages`)
      if (!r.ok) return
      const data = await r.json()
      const conv = data.conversation as Conversation
      const msgs = (data.messages as any[]).map(m => ({ id: m.id, role: m.role, content: m.content })) as ChatMessage[]
      setConversationId(conv.id)
      setMessages(msgs)
      setActiveProfileId(conv.profile_id)
      setSelectedModel(conv.model || '')
    } catch {}
  }

  async function refreshMessages(currentId: number | null) {
    if (!currentId) return
    try {
      const r = await fetch(`${API_BASE()}/api/conversations/${currentId}/messages`)
      if (!r.ok) return
      const data = await r.json()
      const msgs = (data.messages as any[]).map((m: any) => ({ id: m.id, role: m.role, content: m.content })) as ChatMessage[]
      setMessages(msgs)
    } catch {}
  }

  async function handleSend() {
    if (!activeProfileId) return
    const outgoing: ChatMessage = { role: 'user', content: input }
    const parts = imageDataUrl ? [{ type: 'image_url' as const, image_url: { url: imageDataUrl } }] : []
    if (parts.length) outgoing.parts = parts
    setMessages(prev => [...prev, outgoing])
    setInput('')
    setImageDataUrl(null)

    const requestBody = {
      profileId: activeProfileId,
      conversationId: conversationId ?? undefined,
      model: selectedModel || undefined,
      messages: [...messages, outgoing].map(m => ({ role: m.role, content: m.content, parts: m.parts })),
      params: profileSettings || {}
    }

    const debugEnabled = Boolean(profileSettings?.debug)
    if (debugEnabled) {
      setDebugLogs(prev => [...prev, `[client] POST /chat`, JSON.stringify(requestBody, null, 2)])
    }

    if (profileSettings?.stream) {
      // Streaming via SSE over fetch
      try {
        // Prepare placeholder assistant message
        setMessages(prev => [...prev, { role: 'assistant', content: '' }])
        const resp = await fetch(`${API_BASE()}/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(requestBody)
        })
        if (!resp.ok || !resp.body) {
          const text = await resp.text().catch(() => '')
          if (debugEnabled) setDebugLogs(prev => [...prev, `[client] upstream error ${resp.status}`, text])
          // remove placeholder and fall back to error assistant message
          setMessages(prev => {
            const copy = prev.slice()
            // replace last assistant placeholder with error
            const lastIdx = copy.length - 1
            if (lastIdx >= 0 && copy[lastIdx].role === 'assistant' && (copy[lastIdx].content ?? '') === '') {
              copy[lastIdx] = { ...copy[lastIdx], content: 'Error: failed to start stream.' }
            } else {
              copy.push({ role: 'assistant', content: 'Error: failed to start stream.' })
            }
            return copy
          })
          return
        }

        const reader = resp.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''
        let finished = false
        let streamingConvId: number | null = conversationId

        const processBuffer = () => {
          let sepIndex: number
          while ((sepIndex = buffer.indexOf('\n\n')) !== -1) {
            const eventBlock = buffer.slice(0, sepIndex)
            buffer = buffer.slice(sepIndex + 2)
            let eventName: string | null = null
            const dataLines: string[] = []
            for (const line of eventBlock.split('\n')) {
              const trimmed = line.trim()
              if (trimmed.startsWith('event:')) eventName = trimmed.slice(6).trim()
              else if (trimmed.startsWith('data:')) dataLines.push(trimmed.slice(5).trim())
            }
            const dataStr = dataLines.join('\n')
            if (debugEnabled) setDebugLogs(prev => [...prev, `[sse] ${eventName || 'message'}`, dataStr])
            if (eventName === 'meta') {
              try {
                const obj = JSON.parse(dataStr)
                if (obj?.conversationId) {
                  setConversationId(obj.conversationId)
                  streamingConvId = obj.conversationId
                }
              } catch {}
            } else if (eventName === 'title') {
              // simply refresh conversations to pick up the new title from server
              void refreshConversations()
            } else if (eventName === 'debug') {
              // already logged raw above
            } else if (eventName === 'chunk') {
              try {
                const obj = JSON.parse(dataStr)
                const content = obj?.content || ''
                if (content) {
                  setMessages(prev => {
                    const copy = prev.slice()
                    // update last assistant message
                    const lastIdx = copy.length - 1
                    if (lastIdx >= 0 && copy[lastIdx].role === 'assistant') {
                      const prevContent = copy[lastIdx].content || ''
                      copy[lastIdx] = { ...copy[lastIdx], content: prevContent + content }
                    }
                    return copy
                  })
                }
              } catch {}
            } else if (eventName === 'done') {
              finished = true
            }
          }
        }

        while (true) {
          const { value, done } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })
          processBuffer()
          if (finished) break
        }

        // flush remaining buffer
        if (buffer) {
          processBuffer()
        }
        // After stream completes, refresh conversation list and messages to get ids and title
        await refreshConversations()
        await refreshMessages(conversationId)
      } catch (e: any) {
        if (debugEnabled) setDebugLogs(prev => [...prev, `[client] stream error`, String(e?.message || e)])
        setMessages(prev => [...prev, { role: 'assistant', content: 'Error: stream interrupted.' }])
      }
      return
    }

    // Non-streaming fallback
    const resp = await fetch(`${API_BASE()}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody)
    })
    const data = await resp.json()
    if (debugEnabled) setDebugLogs(prev => [...prev, `[client] response`, JSON.stringify(data, null, 2)])
    setConversationId(data.conversationId)
    const assistant = data?.response?.choices?.[0]?.message?.content
    setMessages(prev => [...prev, { role: 'assistant', content: typeof assistant === 'string' ? assistant : '' }])
    await refreshConversations()
    await refreshMessages(data.conversationId)
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

  function startNewChat() {
    setConversationId(null)
    setMessages([])
  }

  async function handleDeleteConversation(id: number) {
    await fetch(`${API_BASE()}/api/conversations/${id}`, { method: 'DELETE' })
    await refreshConversations()
    if (conversationId === id) {
      setConversationId(null)
      setMessages([])
    }
  }

  function beginEditMessage(m: ChatMessage) {
    if (!m.id) return
    setEditingMessageId(m.id)
    setEditingContent(m.content || '')
  }

  async function saveEditMessage() {
    if (!editingMessageId) return
    await fetch(`${API_BASE()}/api/messages/${editingMessageId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: editingContent }) })
    setEditingMessageId(null)
    setEditingContent('')
    await refreshMessages(conversationId)
    await refreshConversations()
  }

  async function deleteMessage(id?: number) {
    if (!id) return
    await fetch(`${API_BASE()}/api/messages/${id}`, { method: 'DELETE' })
    await refreshMessages(conversationId)
    await refreshConversations()
  }

  return (
    <div className="flex h-full bg-[#343541] text-[#ECECF1]">
      <aside className="w-64 shrink-0 border-r border-[#2A2B32] bg-[#202123] p-3 flex flex-col gap-2">
        <div className="flex items-center justify-between mb-2">
          <h1 className="text-sm font-semibold text-[#ECECF1]/80">Chats</h1>
          <button className="text-xs px-2 py-1 rounded-md bg-[#10a37f] text-white hover:bg-[#15b374] transition" onClick={startNewChat}>New</button>
        </div>
        <div className="flex flex-col gap-1">
          {conversations.map(c => (
            <div key={c.id} className={`group flex items-center gap-2 ${conversationId === c.id ? 'bg-[#343541] text-[#ECECF1]' : 'hover:bg-[#2A2B32] text-[#ECECF1]/90'} rounded-md`}>
              <button onClick={() => loadConversation(c.id)} className="flex-1 text-left px-2 py-2 truncate">
                <div className="text-sm font-medium truncate">{c.title || 'New Chat'}</div>
              </button>
              <button className="opacity-0 group-hover:opacity-100 text-xs px-2 py-1 text-[#8E8EA0] hover:text-red-400" onClick={() => handleDeleteConversation(c.id)}>Delete</button>
            </div>
          ))}
        </div>
      </aside>
      <main className="flex-1 grid grid-rows-[auto_1fr_auto]">
        <header className="border-b border-[#2A2B32] bg-[#343541] p-3 grid grid-cols-3 items-center">
          <div />
          <div className="justify-self-center flex items-center gap-2">
            <select className="border border-[#565869] rounded-md px-2 py-1 bg-[#40414F] text-[#ECECF1] min-w-[220px]" value={activeProfileId ?? ''} onChange={e => setActiveProfileId(e.target.value === '' ? null : Number(e.target.value))}>
              <option value="">Select a profile</option>
              {profiles.map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
            <button className="text-xs px-2 py-1 rounded-md bg-[#40414F] text-[#ECECF1] border border-[#565869] hover:bg-[#4A4B57]" onClick={() => {
              const name = prompt('Profile name?') || 'New Profile'
              const api_base_url = prompt('API Base URL (e.g. https://api.openai.com)') || ''
              const api_key = prompt('API Key?') || ''
              fetch(`${API_BASE()}/api/profiles`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, api_base_url, api_key }) })
                .then(() => fetch(`${API_BASE()}/api/profiles`).then(r => r.json()).then(setProfiles))
            }}>Add</button>
          </div>
          <div className="justify-self-end flex items-center gap-2 text-sm">
            <select className="border border-[#565869] rounded-md px-2 py-1 bg-[#40414F] text-[#ECECF1]" value={selectedModel} onChange={e => setSelectedModel(e.target.value)}>
              <option value="">Model (auto)</option>
              {models.map((m, idx) => (
                <option key={idx} value={m.id || m.name || String(m)}>{m.id || m.name || String(m)}</option>
              ))}
            </select>
            <button className="px-2 py-1 rounded-md bg-[#40414F] text-[#ECECF1] border border-[#565869] hover:bg-[#4A4B57] transition" onClick={() => setSettingsOpen(true)}>Settings</button>
          </div>
        </header>
        <section className="overflow-y-auto">
          <div className="mx-auto w-full max-w-3xl">
            {messages.map((m, idx) => (
              <div key={idx} className={`${m.role === 'assistant' ? 'bg-[#444654]' : 'bg-transparent'} w-full`}>
                <div className="px-4 py-6">
                  <div className="flex items-start gap-4">
                    <div className={`shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold ${m.role === 'assistant' ? 'bg-[#10a37f] text-white' : 'bg-[#40414F] text-[#ECECF1]'}`}>{m.role[0].toUpperCase()}</div>
                    <div className="min-w-0 flex-1 whitespace-pre-wrap leading-relaxed text-[#ECECF1]">
                      {editingMessageId === m.id ? (
                        <div className="space-y-2">
                          <textarea value={editingContent} onChange={e => setEditingContent(e.target.value)} rows={3} className="w-full resize-none rounded-md border border-[#565869] bg-[#40414F] text-[#ECECF1] p-2 focus:outline-none focus:ring-1 focus:ring-[#565869]" />
                          <div className="flex items-center gap-2 text-sm">
                            <button className="px-2 py-1 rounded-md bg-[#10a37f] text-white hover:bg-[#15b374]" onClick={saveEditMessage}>Save</button>
                            <button className="px-2 py-1 rounded-md border border-[#565869] bg-[#40414F] hover:bg-[#4A4B57]" onClick={() => { setEditingMessageId(null); setEditingContent('') }}>Cancel</button>
                          </div>
                        </div>
                      ) : (
                        <>
                          {m.content && <p>{m.content}</p>}
                          {m.parts?.filter(p => p.type === 'image_url').map((p, i) => (
                            <img key={i} src={(p as any).image_url.url} alt="uploaded" className="mt-3 rounded-md border border-[#2A2B32] max-w-sm" />
                          ))}
                          {m.id && (
                            <div className="mt-2 text-xs text-[#9B9CA8] flex items-center gap-3 opacity-70">
                              <button className="underline" onClick={() => beginEditMessage(m)}>Edit</button>
                              <button className="underline" onClick={() => deleteMessage(m.id)}>Delete</button>
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
        {profileSettings?.debug && (
          <section className="border-t border-[#2A2B32] bg-[#1E1F24] p-3 text-sm font-mono text-[#B0B2C3] max-h-56 overflow-y-auto">
            <div className="mx-auto w-full max-w-3xl">
              <div className="mb-2 text-[#9B9CA8]">Debug terminal</div>
              <pre className="whitespace-pre-wrap break-words">
                {debugLogs.join('\n')}
              </pre>
            </div>
          </section>
        )}
        <footer className="border-t border-[#2A2B32] bg-[#343541] p-4">
          <div className="max-w-3xl mx-auto">
            <div className="flex items-end gap-2">
              <div className="flex-1 relative">
                <textarea value={input} onChange={e => setInput(e.target.value)} className="w-full resize-none rounded-2xl border border-[#565869] bg-[#40414F] text-[#ECECF1] placeholder-[#9B9CA8] p-4 pr-28 focus:outline-none focus:ring-1 focus:ring-[#565869]" rows={3} placeholder="Message ChatGPT..." />
                <div className="absolute right-2 bottom-2 flex items-center gap-2">
                  <input ref={fileInputRef} type="file" accept="image/*" onChange={handleUploadChange} className="hidden" />
                  <button className="px-2 py-1 text-xs rounded-md bg-[#40414F] text-[#ECECF1] border border-[#565869] hover:bg-[#4A4B57] transition" onClick={() => fileInputRef.current?.click()}>Upload</button>
                  <button className="px-3 py-2 rounded-md bg-[#10a37f] text-white hover:bg-[#15b374] transition" onClick={handleSend}>Send</button>
                </div>
              </div>
            </div>
            {imageDataUrl && (
              <div className="mt-2 text-sm text-[#9B9CA8] flex items-center gap-2">
                <img src={imageDataUrl} className="h-10 w-10 object-cover rounded border border-[#2A2B32]" />
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
