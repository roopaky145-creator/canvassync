const mongoose = require('mongoose');

const RoomSchema = new mongoose.Schema({
  roomCode:    { type: String, required: true, unique: true, index: true },
  canvasState: { type: String },          // Stringified JSON of fabric.Canvas.toJSON()
  lastUpdated: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Room', RoomSchema);
