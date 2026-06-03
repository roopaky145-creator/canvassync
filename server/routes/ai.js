const express = require('express');
const { InferenceClient } = require('@huggingface/inference');
const router = express.Router();

const DEFAULT_IMAGE_MODEL = 'black-forest-labs/FLUX.1-schnell';

function getErrorMessage(err) {
  const details = err?.cause?.message || err?.message || 'Unknown AI generation error';
  return details.replace(process.env.AI_API_KEY || '', '[redacted]');
}

module.exports = (io) => {
  router.post('/generate', async (req, res) => {
    try {
      const { prompt, roomCode } = req.body;
      if (!prompt || !roomCode) {
        return res.status(400).json({ error: 'prompt and roomCode are required' });
      }

      if (!process.env.AI_API_KEY) {
        return res.status(500).json({ error: 'AI_API_KEY is not configured on the server' });
      }

      const client = new InferenceClient(process.env.AI_API_KEY);
      const image = await client.textToImage({
        model: process.env.AI_IMAGE_MODEL || DEFAULT_IMAGE_MODEL,
        inputs: prompt.trim(),
        provider: process.env.AI_PROVIDER || 'auto',
      });

      // Convert the binary image response into a Base64 string.
      const arrayBuffer = await image.arrayBuffer();
      const base64 = Buffer.from(arrayBuffer).toString('base64');

      // Broadcast to all clients in this room
      io.to(roomCode).emit('ai_image_generated', { base64 });
      res.json({ success: true });
      
    } catch (err) {
      const message = getErrorMessage(err);
      console.error('AI generation error:', message);
      res.status(500).json({ error: message });
    }
  });

  return router;
};
