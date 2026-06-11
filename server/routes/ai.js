const express = require('express');
const crypto = require('crypto');
const { InferenceClient } = require('@huggingface/inference');
const { roomTransientLedger, roomEventCounters } = require('../socket/roomHandlers');
const router = express.Router();

const DEFAULT_IMAGE_MODEL = 'black-forest-labs/FLUX.1-schnell';
const DEFAULT_AI_TIMEOUT_MS = 60000;

function getErrorMessage(err) {
  const details = err?.cause?.message || err?.message || 'Unknown AI generation error';
  return details.replace(process.env.AI_API_KEY || '', '[redacted]');
}

function withTimeout(promise, timeoutMs) {
  let timeoutId;
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error('AI provider timed out')), timeoutMs);
  });

  return Promise.race([promise, timeout]).finally(() => clearTimeout(timeoutId));
}

module.exports = (io) => {
  router.post('/generate', async (req, res) => {
    try {
      const { prompt, roomCode } = req.body;
      const promptText = typeof prompt === 'string' ? prompt.trim() : '';
      const targetRoom = typeof roomCode === 'string' ? roomCode.trim() : '';

      if (!promptText || !targetRoom) {
        return res.status(400).json({ error: 'prompt and roomCode are required' });
      }

      if (promptText.length > 4000) {
        return res.status(400).json({ error: 'prompt must be 4000 characters or fewer' });
      }

      if (!process.env.AI_API_KEY) {
        return res.status(500).json({ error: 'AI_API_KEY is not configured on the server' });
      }

      const client = new InferenceClient(process.env.AI_API_KEY);
      const timeoutMs = Number(process.env.AI_TIMEOUT_MS) || DEFAULT_AI_TIMEOUT_MS;
      const image = await withTimeout(
        client.textToImage({
          model: process.env.AI_IMAGE_MODEL || DEFAULT_IMAGE_MODEL,
          inputs: promptText,
          provider: process.env.AI_PROVIDER || 'auto',
        }),
        timeoutMs
      );

      // Convert the binary image response into a Base64 string.
      const arrayBuffer = await image.arrayBuffer();
      const base64 = Buffer.from(arrayBuffer).toString('base64');

      // Generate a single shared ID so every client uses the same object ID
      const imageId = crypto.randomUUID();

      if (!roomEventCounters[targetRoom]) roomEventCounters[targetRoom] = 0;
      const eventId = ++roomEventCounters[targetRoom];
      
      const generatedData = { base64, imageId, eventId };

      if (!roomTransientLedger[targetRoom]) roomTransientLedger[targetRoom] = [];
      roomTransientLedger[targetRoom].push({ 
        event: 'ai_image_generated', 
        data: generatedData, 
        timestamp: Date.now(),
        eventId
      });

      // Broadcast to all clients in this room (shared imageId prevents sync divergence)
      io.to(targetRoom).emit('ai_image_generated', generatedData);

      res.json({ success: true });
      
    } catch (err) {
      const message = getErrorMessage(err);
      console.error('AI generation error:', message);
      res.status(500).json({ error: message });
    }
  });

  return router;
};
