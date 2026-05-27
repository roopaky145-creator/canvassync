const activeLocks = new Map(); // module scope — ONE instance for the entire process

function registerRoomHandlers(io, socket) {
  socket.on('join_room', (roomCode) => {
    socket.roomCode = roomCode;
    socket.join(roomCode);
  });

  socket.on('canvas_update', (data) => {
    socket.to(data.roomCode).emit('canvas_update', data);
  });

  socket.on('canvas_delete', (data) => {
    if (data.objectId) {
      activeLocks.delete(data.objectId); // pre-clean any lock on deleted object
    }
    socket.to(data.roomCode).emit('canvas_delete', { objectId: data.objectId });
  });
}

module.exports = { registerRoomHandlers, activeLocks };
