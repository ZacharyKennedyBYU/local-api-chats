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
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4">
      <div className="bg-[#343541] text-[#ECECF1] rounded-lg shadow-2xl w-full max-w-lg border border-[#2A2B32]">
        <div className="border-b border-[#2A2B32] p-4 font-semibold">Profile Settings</div>
        <div className="p-4 space-y-4">
          <div className="grid grid-cols-2 gap-4 items-end">
            <label className="text-sm text-[#ECECF1]/80">Temperature</label>
            <div className="flex items-center gap-2">
              <input type="number" min={0} max={2} step={0.1} value={temperature as any} onChange={e => setTemperature(e.target.value === '' ? '' : Number(e.target.value))} className="border border-[#565869] rounded-md px-2 py-1 w-32 bg-[#40414F] text-[#ECECF1]" />
              <label className="text-sm flex items-center gap-1 text-[#ECECF1]/80">
                <input type="checkbox" className="accent-[#10a37f]" checked={include.temperature !== false} onChange={e => setInclude({ ...include, temperature: e.target.checked })} /> include
              </label>
            </div>
            <label className="text-sm text-[#ECECF1]/80">Max context</label>
            <div className="flex items-center gap-2">
              <input type="number" min={1} value={maxContext as any} onChange={e => setMaxContext(e.target.value === '' ? '' : Number(e.target.value))} className="border border-[#565869] rounded-md px-2 py-1 w-32 bg-[#40414F] text-[#ECECF1]" />
              <label className="text-sm flex items-center gap-1 text-[#ECECF1]/80">
                <input type="checkbox" className="accent-[#10a37f]" checked={include.max_context !== false} onChange={e => setInclude({ ...include, max_context: e.target.checked })} /> include
              </label>
            </div>
            <label className="text-sm text-[#ECECF1]/80">Max response tokens</label>
            <div className="flex items-center gap-2">
              <input type="number" min={1} value={maxTokens as any} onChange={e => setMaxTokens(e.target.value === '' ? '' : Number(e.target.value))} className="border border-[#565869] rounded-md px-2 py-1 w-32 bg-[#40414F] text-[#ECECF1]" />
              <label className="text-sm flex items-center gap-1 text-[#ECECF1]/80">
                <input type="checkbox" className="accent-[#10a37f]" checked={include.max_output_tokens !== false} onChange={e => setInclude({ ...include, max_output_tokens: e.target.checked })} /> include
              </label>
            </div>
          </div>
        </div>
        <div className="border-t border-[#2A2B32] p-4 flex justify-end gap-2">
          <button className="px-3 py-2 rounded-md border border-[#565869] bg-[#40414F] text-[#ECECF1] hover:bg-[#4A4B57] transition" onClick={onClose}>Cancel</button>
          <button className="px-3 py-2 rounded-md bg-[#10a37f] text-white hover:bg-[#15b374] transition" onClick={() => onSave({ temperature: temperature === '' ? undefined : temperature, max_context: maxContext === '' ? undefined : maxContext, max_output_tokens: maxTokens === '' ? undefined : maxTokens, include_settings: include })}>Save</button>
        </div>
      </div>
    </div>
  )
}

