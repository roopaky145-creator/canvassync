import React, { useState } from 'react';
import { MousePointer, Square, Circle, PenTool, Eraser, Minus, Type, Undo, Redo, Palette, Download } from 'lucide-react';

const Toolbar = ({ activeTool, setActiveTool, onSave, handleUndo, handleRedo, brushColor, setBrushColor, brushWidth, setBrushWidth, isSaving }) => {
  const [showSettings, setShowSettings] = useState(false);

  const tools = [
    { id: 'select', icon: <MousePointer size={20} />, title: 'Select' },
    { id: 'rect', icon: <Square size={20} />, title: 'Rectangle' },
    { id: 'circle', icon: <Circle size={20} />, title: 'Circle' },
    { id: 'line', icon: <Minus size={20} />, title: 'Line' },
    { id: 'pen', icon: <PenTool size={20} />, title: 'Pen' },
    { id: 'eraser', icon: <Eraser size={20} />, title: 'Eraser' },
    { id: 'text', icon: <Type size={20} />, title: 'Text' },
  ];

  const handleToolClick = (toolId) => {
    setActiveTool(toolId);
  };

  return (
    <div style={{ position: 'absolute', top: '20px', left: '50%', transform: 'translateX(-50%)', zIndex: 10 }}>
      <div style={{ 
        display: 'flex', 
        gap: '8px', 
        padding: '8px 12px', 
        backgroundColor: '#ffffff', 
        borderRadius: '12px', 
        boxShadow: '0 4px 6px rgba(0,0,0,0.1)', 
        alignItems: 'center' 
      }}>
        {tools.map((tool) => (
          <button
            key={tool.id}
            title={tool.title}
            onClick={() => handleToolClick(tool.id)}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: '36px',
              height: '36px',
              border: 'none',
              borderRadius: '8px',
              backgroundColor: activeTool === tool.id ? '#e2e8f0' : 'transparent',
              color: activeTool === tool.id ? '#0f172a' : '#64748b',
              cursor: 'pointer',
              transition: 'all 0.2s'
            }}
          >
            {tool.icon}
          </button>
        ))}

        <div style={{ width: '1px', height: '24px', backgroundColor: '#e2e8f0', margin: '0 4px' }} />

        <button
          title="Color & Width"
          onClick={() => setShowSettings(!showSettings)}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            width: '36px', height: '36px', border: 'none', borderRadius: '8px',
            backgroundColor: showSettings ? '#e2e8f0' : 'transparent',
            color: showSettings ? '#0f172a' : '#64748b', cursor: 'pointer'
          }}
        >
          <Palette size={20} />
        </button>

        <div style={{ width: '1px', height: '24px', backgroundColor: '#e2e8f0', margin: '0 4px' }} />

        <button
          title="Undo"
          onClick={handleUndo}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            width: '36px', height: '36px', border: 'none', borderRadius: '8px',
            backgroundColor: 'transparent', color: '#64748b', cursor: 'pointer'
          }}
        >
          <Undo size={20} />
        </button>
        
        <button
          title="Redo"
          onClick={handleRedo}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            width: '36px', height: '36px', border: 'none', borderRadius: '8px',
            backgroundColor: 'transparent', color: '#64748b', cursor: 'pointer'
          }}
        >
          <Redo size={20} />
        </button>

        <div className="w-px h-6 bg-gray-300 mx-2" />
        <button 
          onClick={onSave} 
          disabled={isSaving}
          className={`p-2 rounded hover:bg-gray-200 ${isSaving ? 'opacity-50 cursor-not-allowed' : ''}`}
          title="Save Board"
        >
          {isSaving ? 'Saving...' : <Download size={20} />}
        </button>
      </div>

      {showSettings && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 10px)', right: '100px',
          backgroundColor: '#ffffff', borderRadius: '12px', padding: '16px',
          boxShadow: '0 4px 12px rgba(0,0,0,0.15)', display: 'flex', flexDirection: 'column', gap: '12px'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', justifyContent: 'space-between' }}>
            <label style={{ fontSize: '14px', color: '#334155' }}>Color</label>
            <input 
              type="color" 
              value={brushColor} 
              onChange={(e) => setBrushColor(e.target.value)} 
              style={{ border: 'none', width: '28px', height: '28px', padding: 0, cursor: 'pointer', borderRadius: '4px' }}
            />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', justifyContent: 'space-between' }}>
            <label style={{ fontSize: '14px', color: '#334155' }}>Width: {brushWidth}</label>
            <input 
              type="range" 
              min="1" 
              max="20" 
              value={brushWidth} 
              onChange={(e) => setBrushWidth(Number(e.target.value))} 
              style={{ width: '100px' }}
            />
          </div>
        </div>
      )}
    </div>
  );
};

export default Toolbar;
