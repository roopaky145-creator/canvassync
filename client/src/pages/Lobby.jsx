import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import './Lobby.css';

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
    <div className="lobby-card">
      <h1 className="lobby-title">CanvasSync Lobby</h1>
      
      <div className="lobby-section">
        <h2 className="lobby-subtitle">Create a New Room</h2>
        <button 
          onClick={handleCreateRoom} 
          disabled={isCreating}
          className="lobby-button"
        >
          {isCreating ? 'Creating...' : 'Create Room'}
        </button>
        {error && <p className="lobby-error">{error}</p>}
      </div>

      <div className="lobby-section">
        <h2 className="lobby-subtitle">Join an Existing Room</h2>
        <input 
          type="text" 
          value={inputValue} 
          onChange={(e) => setInputValue(e.target.value)} 
          placeholder="Enter room code"
          className="lobby-input"
        />
        <button 
          onClick={handleJoinRoom}
          disabled={!inputValue.trim()}
          className="lobby-button"
        >
          Join
        </button>
      </div>
    </div>
  );
};

export default Lobby;
