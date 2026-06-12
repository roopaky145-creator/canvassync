const mongoose = require('mongoose');

const BoardSchema = new mongoose.Schema({
  roomCode: { type: String, required: true, unique: true },
  canvasState: { type: Object, required: true },
  lastUpdated: { type: Number }
});

module.exports = mongoose.model('Board', BoardSchema);
