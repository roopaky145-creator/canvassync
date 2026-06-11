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

    if (typeof timestamp !== 'number' || !isFinite(timestamp)) {
      return res.status(400).json({ error: 'Valid finite timestamp required' });
    }

    // Atomic update: Only update if the document doesn't exist, OR if lastUpdated is older/missing
    const updateResult = await Board.updateOne(
      { 
        roomCode, 
        $or: [ 
          { lastUpdated: { $lt: timestamp } }, 
          { lastUpdated: { $exists: false } },
          { lastUpdated: null }
        ] 
      },
      { $set: { canvasState, lastUpdated: timestamp } }
    );

    // If no document was modified, it either doesn't exist, OR it was rejected due to an older timestamp
    if (updateResult.matchedCount === 0) {
      const existingBoard = await Board.findOne({ roomCode });
      if (existingBoard) {
        return res.status(409).json({ error: 'Stale save detected. Database has a newer version.' });
      } else {
        // First time saving this room
        await Board.create({ roomCode, canvasState, lastUpdated: timestamp });
      }
    }

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
