const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const Board = mongoose.model('Board');

router.post('/:roomCode/save', async (req, res) => {
  try {
    const { roomCode } = req.params;
    const { canvasState } = req.body;
    
    await Board.findOneAndUpdate(
      { roomCode },
      { roomCode, canvasState },
      { upsert: true, new: true }
    );
    
    res.status(200).json({ success: true });
  } catch (err) {
    console.error('Save error:', err);
    res.status(500).json({ error: 'Failed to save board state' });
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
