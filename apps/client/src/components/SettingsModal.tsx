import React, { useState } from 'react'

type Props = {
  open: boolean
  onClose: () => void
  initial?: any
  onSave: (settings: any) => void
}

export default function SettingsModal({ open, onClose, initial, onSave }: Props) {
  const [temperature, setTemperature] = useState<number | ''>(initial?.temperature ?? '')
  const [maxContext, setMaxContext] = useState<number | ''>(initial?.max_context ?? '')
  const [maxTokens, setMaxTokens] = useState<number | ''>(initial?.max_output_tokens ?? '')
  const [include, setInclude] = useState<Record<string, boolean>>(
    initial?.include_settings ?? { temperature: true, max_context: true, max_output_tokens: true }
  )

  if (!open) return null

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4">
      <div className="bg-white rounded shadow-lg w-full max-w-lg">
        <div className="border-b p-3 font-semibold">Profile Settings</div>
        <div className="p-4 space-y-3">
          <div className="grid grid-cols-2 gap-3 items-end">
            <label className="text-sm">Temperature</label>
            <div className="flex items-center gap-2">
              <input type="number" min={0} max={2} step={0.1} value={temperature as any} onChange={e => setTemperature(e.target.value === '' ? '' : Number(e.target.value))} className="border rounded px-2 py-1 w-32" />
              <label className="text-sm flex items-center gap-1">
                <input type="checkbox" checked={include.temperature !== false} onChange={e => setInclude({ ...include, temperature: e.target.checked })} /> include
              </label>
            </div>
            <label className="text-sm">Max context</label>
            <div className="flex items-center gap-2">
              <input type="number" min={1} value={maxContext as any} onChange={e => setMaxContext(e.target.value === '' ? '' : Number(e.target.value))} className="border rounded px-2 py-1 w-32" />
              <label className="text-sm flex items-center gap-1">
                <input type="checkbox" checked={include.max_context !== false} onChange={e => setInclude({ ...include, max_context: e.target.checked })} /> include
              </label>
            </div>
            <label className="text-sm">Max response tokens</label>
            <div className="flex items-center gap-2">
              <input type="number" min={1} value={maxTokens as any} onChange={e => setMaxTokens(e.target.value === '' ? '' : Number(e.target.value))} className="border rounded px-2 py-1 w-32" />
              <label className="text-sm flex items-center gap-1">
                <input type="checkbox" checked={include.max_output_tokens !== false} onChange={e => setInclude({ ...include, max_output_tokens: e.target.checked })} /> include
              </label>
            </div>
          </div>
        </div>
        <div className="border-t p-3 flex justify-end gap-2">
          <button className="px-3 py-1 rounded" onClick={onClose}>Cancel</button>
          <button className="px-3 py-1 rounded bg-blue-600 text-white" onClick={() => onSave({ temperature: temperature === '' ? undefined : temperature, max_context: maxContext === '' ? undefined : maxContext, max_output_tokens: maxTokens === '' ? undefined : maxTokens, include_settings: include })}>Save</button>
        </div>
      </div>
    </div>
  )
}

