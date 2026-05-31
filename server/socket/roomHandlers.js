const activeLocks = new Map(); // module scope — ONE instance for the entire process

function registerRoomHandlers(io, socket) {
  socket.on('join_room', (roomCode) => {
    if (socket.roomCode) socket.leave(socket.roomCode);
    socket.roomCode = roomCode;
    socket.join(roomCode);
  });

  socket.on('canvas_update', (data) => {
    if (!data?.roomCode || !socket.rooms.has(data.roomCode)) return;
    socket.to(data.roomCode).emit('canvas_update', data);
  });

  socket.on('canvas_delete', (data) => {
    if (!data?.roomCode || !data?.objectId || !socket.rooms.has(data.roomCode)) return;
    activeLocks.delete(data.objectId);
    socket.to(data.roomCode).emit('canvas_delete', { objectId: data.objectId });
  });

  // Acquire a lock — first come, first served
  socket.on('acquire_lock', (data) => {
    if (!activeLocks.has(data.object_id)) {
      activeLocks.set(data.object_id, socket.id);
      io.to(data.roomCode).emit('lock_acquired', {
        object_id: data.object_id,
        lockedBy: socket.id
      });
    }
  });

  // Release a lock — only the owner can release
  socket.on('release_lock', (data) => {
    if (activeLocks.get(data.object_id) === socket.id) {
      activeLocks.delete(data.object_id);
      io.to(data.roomCode).emit('lock_released', { object_id: data.object_id });
    }
  });

  // On disconnect — release all locks held by this socket
  socket.on('disconnect', () => {
    const roomCode = socket.roomCode;
    if (!roomCode) return;
    activeLocks.forEach((ownerId, objectId) => {
      if (ownerId === socket.id) {
        activeLocks.delete(objectId);
      }
    });
    io.to(roomCode).emit('user_disconnected_locks_cleared', socket.id);
  });
}

module.exports = { registerRoomHandlers, activeLocks };
