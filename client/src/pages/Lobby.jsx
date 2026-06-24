import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';

const Lobby = () => {
  const [inputValue, setInputValue] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState(null);
  const navigate = useNavigate();

  const handleCreateRoom = async () => {
    setIsCreating(true);
    setError(null);
    try {
      const response = await fetch(`${process.env.REACT_APP_BACKEND_URL}/api/rooms/create`, {
        method: 'POST',
      });
      
      if (!response.ok) {
        throw new Error('Failed to create room');
      }

      const data = await response.json();
      if (data && data.roomCode) {
        navigate(`/room/${data.roomCode}`);
      } else {
        throw new Error('Invalid response from server');
      }
    } catch (err) {
      setError(err.message || 'Something went wrong');
    } finally {
      setIsCreating(false);
    }
  };

  const handleJoinRoom = () => {
    if (inputValue.trim()) {
      navigate(`/room/${inputValue.trim()}`);
    }
  };

  return (
    <div style={{ padding: '2rem', fontFamily: 'sans-serif' }}>
      <h1>CanvasSync Lobby</h1>
      
      <div style={{ marginBottom: '2rem' }}>
        <h2>Create a New Room</h2>
        <button 
          onClick={handleCreateRoom} 
          disabled={isCreating}
          style={{ padding: '0.5rem 1rem', cursor: isCreating ? 'not-allowed' : 'pointer' }}
        >
          {isCreating ? 'Creating...' : 'Create Room'}
        </button>
        {error && <p style={{ color: 'red' }}>{error}</p>}
      </div>

      <div>
        <h2>Join an Existing Room</h2>
        <input 
          type="text" 
          value={inputValue} 
          onChange={(e) => setInputValue(e.target.value)} 
          placeholder="Enter room code"
          style={{ padding: '0.5rem', marginRight: '0.5rem' }}
        />
        <button 
          onClick={handleJoinRoom}
          disabled={!inputValue.trim()}
          style={{ padding: '0.5rem 1rem', cursor: !inputValue.trim() ? 'not-allowed' : 'pointer' }}
        >
          Join
        </button>
      </div>
    </div>
  );
};

export default Lobby;
