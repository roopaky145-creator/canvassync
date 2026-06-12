import React, { useState } from 'react';
import './AIPromptPanel.css';

const getDisplayError = (message) => {
  const text = message?.trim();
  if (!text) return 'AI generation failed. Please try again in a few moments.';

  if (/invalid|unauthorized|password|AI_API_KEY/i.test(text)) {
    return text;
  }

  // Catch all transient / network / rate-limit / HF-specific errors
  if (/fetch|network|timeout|rate|limit|tempor|unavailable|provider|503|429|402|500|failed|loading|busy|overloaded|quota|ENOTFOUND|timed out/i.test(text)) {
    return 'AI generation failed. Please try again in a few moments.';
  }

  return text;
};

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
      setError(getDisplayError(e.message));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="ai-prompt-panel" style={{ position: 'fixed', top: '100px', right: '30px', zIndex: 100 }}>
      <h3 className="ai-prompt-header">AI Canvas Generator</h3>
      <textarea
        className="ai-prompt-input"
        value={prompt}
        onChange={e => setPrompt(e.target.value)}
        placeholder="Describe an image to generate (e.g. 'a futuristic city at sunset')..."
        maxLength={4000}
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
