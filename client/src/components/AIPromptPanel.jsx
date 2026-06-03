import React, { useState } from 'react';
import './AIPromptPanel.css';

const AIPromptPanel = ({ roomCode }) => {
  const [prompt, setPrompt] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const handleGenerate = async () => {
    if (!prompt.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${process.env.REACT_APP_BACKEND_URL}/api/ai/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, roomCode })
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Generation failed');
      }
      // Clear prompt on success (optional)
      setPrompt('');
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="ai-prompt-panel">
      <h3 className="ai-prompt-header">AI Canvas Generator</h3>
      <textarea
        className="ai-prompt-input"
        value={prompt}
        onChange={e => setPrompt(e.target.value)}
        placeholder="Describe an image to generate (e.g. 'a futuristic city at sunset')..."
        disabled={loading}
      />
      <button 
        className="ai-prompt-button" 
        onClick={handleGenerate} 
        disabled={loading || !prompt.trim()}
      >
        {loading ? 'Generating...' : 'Generate Image'}
      </button>
      {error && <p className="ai-prompt-error">{error}</p>}
    </div>
  );
};

export default AIPromptPanel;
