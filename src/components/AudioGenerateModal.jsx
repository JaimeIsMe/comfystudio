import { useState } from 'react'
import { X, Music, Mic, Volume2, Sparkles, RefreshCw, Clock, Wand2 } from 'lucide-react'

function AudioGenerateModal({ isOpen, onClose, initialType = 'music' }) {
  const [audioType, setAudioType] = useState(initialType)
  const [prompt, setPrompt] = useState('')
  const [duration, setDuration] = useState(30)
  const [isGenerating, setIsGenerating] = useState(false)
  
  // Type-specific settings
  const [voiceSettings, setVoiceSettings] = useState({
    voice: 'narrator-male',
    speed: 1.0,
    script: ''
  })
  
  const [musicSettings, setMusicSettings] = useState({
    genre: 'cinematic',
    mood: 'epic',
    tempo: 'medium'
  })

  const audioTypes = [
    { id: 'music', label: 'Music', icon: Music, color: 'pink' },
    { id: 'voiceover', label: 'Voiceover', icon: Mic, color: 'cyan' },
    { id: 'sfx', label: 'Sound Effects', icon: Volume2, color: 'yellow' },
  ]

  const voices = [
    { id: 'narrator-male', name: 'Narrator (Male)', desc: 'Deep, authoritative' },
    { id: 'narrator-female', name: 'Narrator (Female)', desc: 'Warm, professional' },
    { id: 'commercial-male', name: 'Commercial (Male)', desc: 'Energetic, friendly' },
    { id: 'commercial-female', name: 'Commercial (Female)', desc: 'Bright, engaging' },
    { id: 'documentary', name: 'Documentary', desc: 'Calm, informative' },
  ]

  const genres = ['cinematic', 'electronic', 'orchestral', 'ambient', 'rock', 'jazz', 'corporate']
  const moods = ['epic', 'tense', 'uplifting', 'melancholic', 'energetic', 'calm', 'mysterious']
  const tempos = ['slow', 'medium', 'fast']

  const handleGenerate = () => {
    setIsGenerating(true)
    // Simulate generation
    setTimeout(() => {
      setIsGenerating(false)
      // Would add clip to timeline
    }, 3000)
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="bg-sf-dark-900 border border-sf-dark-600 rounded-xl w-[600px] max-h-[80vh] overflow-hidden shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-sf-dark-700">
          <div className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-sf-accent" />
            <h2 className="text-lg font-medium text-sf-text-primary">Generate Audio</h2>
          </div>
          <button 
            onClick={onClose}
            className="p-1 hover:bg-sf-dark-700 rounded transition-colors"
          >
            <X className="w-5 h-5 text-sf-text-muted" />
          </button>
        </div>
        
        {/* Audio Type Tabs */}
        <div className="flex border-b border-sf-dark-700">
          {audioTypes.map((type) => {
            const Icon = type.icon
            const isActive = audioType === type.id
            return (
              <button
                key={type.id}
                onClick={() => setAudioType(type.id)}
                className={`flex-1 flex items-center justify-center gap-2 px-4 py-3 transition-colors ${
                  isActive 
                    ? `bg-sf-dark-800 border-b-2 border-${type.color}-500 text-sf-text-primary` 
                    : 'text-sf-text-muted hover:text-sf-text-secondary hover:bg-sf-dark-800'
                }`}
              >
                <Icon className={`w-4 h-4 ${isActive ? `text-${type.color}-400` : ''}`} />
                <span className="text-sm font-medium">{type.label}</span>
              </button>
            )
          })}
        </div>
        
        {/* Content */}
        <div className="p-4 overflow-y-auto max-h-[50vh]">
          {/* Music Generation */}
          {audioType === 'music' && (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-sf-text-primary mb-2">
                  Describe the music
                </label>
                <textarea
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  placeholder="Epic orchestral music building to a triumphant climax, with dramatic percussion and soaring strings..."
                  className="w-full h-24 bg-sf-dark-800 border border-sf-dark-600 rounded-lg p-3 text-sm text-sf-text-primary placeholder-sf-text-muted resize-none focus:outline-none focus:border-sf-accent"
                />
              </div>
              
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs text-sf-text-secondary mb-1">Genre</label>
                  <select 
                    value={musicSettings.genre}
                    onChange={(e) => setMusicSettings({ ...musicSettings, genre: e.target.value })}
                    className="w-full bg-sf-dark-800 border border-sf-dark-600 rounded px-3 py-2 text-sm text-sf-text-primary focus:outline-none focus:border-sf-accent capitalize"
                  >
                    {genres.map(g => <option key={g} value={g}>{g}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-sf-text-secondary mb-1">Mood</label>
                  <select 
                    value={musicSettings.mood}
                    onChange={(e) => setMusicSettings({ ...musicSettings, mood: e.target.value })}
                    className="w-full bg-sf-dark-800 border border-sf-dark-600 rounded px-3 py-2 text-sm text-sf-text-primary focus:outline-none focus:border-sf-accent capitalize"
                  >
                    {moods.map(m => <option key={m} value={m}>{m}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-sf-text-secondary mb-1">Tempo</label>
                  <select 
                    value={musicSettings.tempo}
                    onChange={(e) => setMusicSettings({ ...musicSettings, tempo: e.target.value })}
                    className="w-full bg-sf-dark-800 border border-sf-dark-600 rounded px-3 py-2 text-sm text-sf-text-primary focus:outline-none focus:border-sf-accent capitalize"
                  >
                    {tempos.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
              </div>
            </div>
          )}
          
          {/* Voiceover Generation */}
          {audioType === 'voiceover' && (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-sf-text-primary mb-2">
                  Script
                </label>
                <textarea
                  value={voiceSettings.script}
                  onChange={(e) => setVoiceSettings({ ...voiceSettings, script: e.target.value })}
                  placeholder="Enter the text you want spoken. Each paragraph will be a natural pause..."
                  className="w-full h-32 bg-sf-dark-800 border border-sf-dark-600 rounded-lg p-3 text-sm text-sf-text-primary placeholder-sf-text-muted resize-none focus:outline-none focus:border-sf-accent"
                />
                <div className="flex justify-between mt-1">
                  <span className="text-xs text-sf-text-muted">
                    {voiceSettings.script.length} characters
                  </span>
                  <span className="text-xs text-sf-text-muted">
                    ~{Math.ceil(voiceSettings.script.split(' ').filter(w => w).length / 150)} min read
                  </span>
                </div>
              </div>
              
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs text-sf-text-secondary mb-1">Voice</label>
                  <select 
                    value={voiceSettings.voice}
                    onChange={(e) => setVoiceSettings({ ...voiceSettings, voice: e.target.value })}
                    className="w-full bg-sf-dark-800 border border-sf-dark-600 rounded px-3 py-2 text-sm text-sf-text-primary focus:outline-none focus:border-sf-accent"
                  >
                    {voices.map(v => (
                      <option key={v.id} value={v.id}>{v.name}</option>
                    ))}
                  </select>
                  <p className="text-xs text-sf-text-muted mt-1">
                    {voices.find(v => v.id === voiceSettings.voice)?.desc}
                  </p>
                </div>
                <div>
                  <label className="block text-xs text-sf-text-secondary mb-1">Speed: {voiceSettings.speed}x</label>
                  <input
                    type="range"
                    min="0.5"
                    max="2"
                    step="0.1"
                    value={voiceSettings.speed}
                    onChange={(e) => setVoiceSettings({ ...voiceSettings, speed: parseFloat(e.target.value) })}
                    className="w-full h-2 bg-sf-dark-600 rounded-lg appearance-none cursor-pointer accent-sf-accent"
                  />
                  <div className="flex justify-between text-[10px] text-sf-text-muted mt-1">
                    <span>Slower</span>
                    <span>Normal</span>
                    <span>Faster</span>
                  </div>
                </div>
              </div>
              
              <button className="flex items-center gap-2 text-xs text-sf-accent hover:text-sf-accent-hover transition-colors">
                <Wand2 className="w-3 h-3" />
                Generate script from shot descriptions
              </button>
            </div>
          )}
          
          {/* SFX Generation */}
          {audioType === 'sfx' && (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-sf-text-primary mb-2">
                  Describe the sound effect
                </label>
                <textarea
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  placeholder="Dramatic whoosh transition, cinematic impact hit, footsteps on gravel..."
                  className="w-full h-24 bg-sf-dark-800 border border-sf-dark-600 rounded-lg p-3 text-sm text-sf-text-primary placeholder-sf-text-muted resize-none focus:outline-none focus:border-sf-accent"
                />
              </div>
              
              {/* Quick SFX presets */}
              <div>
                <label className="block text-xs text-sf-text-secondary mb-2">Quick Presets</label>
                <div className="flex flex-wrap gap-2">
                  {['Whoosh', 'Impact', 'Transition', 'Ambient', 'Footsteps', 'Door', 'Explosion', 'UI Click'].map(preset => (
                    <button
                      key={preset}
                      onClick={() => setPrompt(preset.toLowerCase())}
                      className="px-3 py-1 bg-sf-dark-700 hover:bg-sf-dark-600 rounded-full text-xs text-sf-text-secondary transition-colors"
                    >
                      {preset}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
          
          {/* Duration (for all types) */}
          <div className="mt-4 pt-4 border-t border-sf-dark-700">
            <div className="flex items-center justify-between">
              <label className="text-sm text-sf-text-secondary flex items-center gap-2">
                <Clock className="w-4 h-4" />
                Duration
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min="1"
                  max="300"
                  value={duration}
                  onChange={(e) => setDuration(parseInt(e.target.value) || 1)}
                  className="w-16 bg-sf-dark-800 border border-sf-dark-600 rounded px-2 py-1 text-sm text-sf-text-primary text-center focus:outline-none focus:border-sf-accent"
                />
                <span className="text-sm text-sf-text-muted">seconds</span>
              </div>
            </div>
            {audioType === 'music' && (
              <div className="flex gap-2 mt-2">
                {[15, 30, 60, 120].map(d => (
                  <button
                    key={d}
                    onClick={() => setDuration(d)}
                    className={`px-3 py-1 rounded text-xs transition-colors ${
                      duration === d 
                        ? 'bg-sf-accent text-white' 
                        : 'bg-sf-dark-700 text-sf-text-secondary hover:bg-sf-dark-600'
                    }`}
                  >
                    {d}s
                  </button>
                ))}
                <button
                  onClick={() => setDuration(66)}
                  className="px-3 py-1 bg-sf-dark-700 text-sf-text-secondary hover:bg-sf-dark-600 rounded text-xs transition-colors"
                >
                  Match timeline
                </button>
              </div>
            )}
          </div>
        </div>
        
        {/* Footer */}
        <div className="flex items-center justify-between p-4 border-t border-sf-dark-700 bg-sf-dark-800">
          <div className="text-xs text-sf-text-muted">
            Audio will be added to the first audio track
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm text-sf-text-secondary hover:text-sf-text-primary transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleGenerate}
              disabled={isGenerating}
              className="flex items-center gap-2 px-5 py-2 bg-sf-accent hover:bg-sf-accent-hover disabled:bg-sf-dark-600 rounded-lg text-sm font-medium text-white transition-colors"
            >
              {isGenerating ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  Generating...
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4" />
                  Generate {audioType === 'music' ? 'Music' : audioType === 'voiceover' ? 'Voiceover' : 'SFX'}
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default AudioGenerateModal
