import React from 'react';

const Toolbar = ({ activeTool, setActiveTool, brushColor, setBrushColor, brushWidth, setBrushWidth }) => {
  const tools = ['select', 'rect', 'circle', 'pen', 'eraser'];

  const handleToolClick = (tool) => {
    setActiveTool(tool);
    window.CANVAS_ACTIVE_TOOL = tool;
  };

  return (
    <div style={{ display: 'flex', gap: '10px', padding: '10px', backgroundColor: '#f0f0f0', alignItems: 'center', marginBottom: '10px' }}>
      {tools.map((tool) => (
        <button
          key={tool}
          onClick={() => handleToolClick(tool)}
          style={{
            padding: '5px 10px',
            backgroundColor: activeTool === tool ? '#d0d0d0' : '#ffffff',
            border: activeTool === tool ? '2px solid #333' : '1px solid #ccc',
            fontWeight: activeTool === tool ? 'bold' : 'normal',
            cursor: 'pointer',
            textTransform: 'capitalize'
          }}
        >
          {tool}
        </button>
      ))}
      <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
        <label htmlFor="brushColor">Color:</label>
        <input 
          id="brushColor"
          type="color" 
          value={brushColor} 
          onChange={(e) => setBrushColor(e.target.value)} 
        />
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
        <label htmlFor="brushWidth">Width: {brushWidth}</label>
        <input 
          id="brushWidth"
          type="range" 
          min="1" 
          max="20" 
          value={brushWidth} 
          onChange={(e) => setBrushWidth(Number(e.target.value))} 
        />
      </div>
    </div>
  );
};

export default Toolbar;
