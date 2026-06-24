import React from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Lobby from './pages/Lobby';
import Canvas from './pages/Canvas';

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Lobby />} />
        <Route path="/room/:code" element={<Canvas />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
