const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const Board = mongoose.model('Board');

router.post('/:roomCode/save', async (req, res) => {
  try {
    const { roomCode } = req.params;
    const { canvasState, timestamp } = req.body;

    if (!canvasState) {
      return res.status(400).json({ error: 'No canvas state provided' });
    }

    // Find the existing board to check its timestamp
    const existingBoard = await Board.findOne({ roomCode });
    
    // If the database has a newer timestamp than the incoming request, reject the stale save
    if (existingBoard && existingBoard.lastUpdated && timestamp && existingBoard.lastUpdated > timestamp) {
      return res.status(409).json({ error: 'Stale save detected. Database has a newer version.' });
    }

    // Upsert the new board state with the new timestamp
    await Board.findOneAndUpdate(
      { roomCode },
      { 
        canvasState: canvasState,
        lastUpdated: timestamp || Date.now() 
      },
      { upsert: true, new: true }
    );

    res.status(200).json({ message: 'Board saved successfully' });
  } catch (error) {
    if (error.message && error.message.toLowerCase().includes('bson size')) {
      return res.status(413).json({ error: 'Board exceeds maximum allowed database size (16MB).' });
    }
    console.error('Save error:', error);
    res.status(500).json({ error: 'Failed to save board state.' });
  }
});

router.get('/:roomCode/load', async (req, res) => {
  try {
    const { roomCode } = req.params;
    const board = await Board.findOne({ roomCode });
    if (board && board.canvasState) {
      return res.status(200).json({ canvasState: board.canvasState });
    }
    res.status(404).json({ error: 'Board not found' });
  } catch (err) {
    console.error('Load error:', err);
    res.status(500).json({ error: 'Failed to load board state' });
  }
});

module.exports = router;
