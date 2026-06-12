const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const Board = mongoose.model('Board');
const { roomTransientLedger } = require('../socket/roomHandlers');

router.post('/:roomCode/save', async (req, res) => {
  try {
    const { roomCode } = req.params;
    const { canvasState, timestamp, watermark } = req.body;

    if (!canvasState) {
      return res.status(400).json({ error: 'No canvas state provided' });
    }

    if (typeof timestamp !== 'number' || !isFinite(timestamp)) {
      return res.status(400).json({ error: 'Valid finite timestamp required' });
    }

    let updateResult = await Board.updateOne(
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

    // If matchedCount is 0, the room either doesn't exist, OR we were legitimately blocked by an older timestamp.
    if (updateResult.matchedCount === 0) {
      try {
        // Attempt to create.
        await Board.create({ roomCode, canvasState, lastUpdated: timestamp });
      } catch (insertError) {
        if (insertError.code === 11000) {
          // CONCURRENCY RACE CAUGHT: Another request just created this room a microsecond ago.
          // The room now exists. We must retry the updateOne to let the database compare the timestamps.
          updateResult = await Board.updateOne(
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

          // If it STILL matches 0 after the retry, our timestamp is mathematically older than the newly created one.
          if (updateResult.matchedCount === 0) {
            return res.status(409).json({ error: 'Stale save detected. Database has a newer version.' });
          }
        } else {
          // Re-throw if it's a real database failure (e.g., connection lost)
          throw insertError; 
        }
      }
    }

    if (roomTransientLedger[roomCode] && watermark !== undefined) {
      roomTransientLedger[roomCode] = roomTransientLedger[roomCode].filter(evt => evt.eventId > watermark);
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
