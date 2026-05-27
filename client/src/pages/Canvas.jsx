import { useEffect, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { io } from 'socket.io-client';
import { v4 as uuidv4 } from 'uuid';
import { throttle } from 'lodash';
import { fabric } from 'fabric';

const Canvas = () => {
  const { code: roomCode } = useParams();
  const canvasRef = useRef(null);        // Needed by handleSave in Phase 5
  const isReceivingUpdate = useRef(false); // Prevents infinite broadcast loops
  const socketRef = useRef(null);         // Exposed for Phase 4 AI panel

  useEffect(() => {
    const socket = io(process.env.REACT_APP_BACKEND_URL);
    socketRef.current = socket;
    const canvas = new fabric.Canvas('canvas-el');
    canvasRef.current = canvas;

    socket.emit('join_room', roomCode);

    // ── EMIT SIDE ────────────────────────────────────────────────
    canvas.on('object:added', (e) => {
      if (!e.target.id) e.target.set('id', uuidv4());
      if (!isReceivingUpdate.current) {
        socket.emit('canvas_update', { roomCode, objectData: e.target.toJSON(['id']) });
      }
    });

    const throttledMove = throttle((e) => {
      if (isReceivingUpdate.current) return;
      socket.emit('canvas_update', { roomCode, objectData: e.target.toJSON(['id']) });
    }, 50);

    canvas.on('object:moving', throttledMove);

    canvas.on('object:modified', (e) => {
      throttledMove.flush();
      if (isReceivingUpdate.current) return;
      socket.emit('canvas_update', { roomCode, objectData: e.target.toJSON(['id']) });
    });

    canvas.on('object:removed', (e) => {
      if (!e.target.id) return; // guard: never emit delete for objects without an ID
      if (isReceivingUpdate.current) return;
      socket.emit('canvas_delete', { roomCode, objectId: e.target.id });
    });

    // ── ROOPAK'S SHAPE DRAWING LOGIC ─────────────────────────────
    let isDrawingShape = false;
    let origX = 0;
    let origY = 0;
    let tempShape = null;

    canvas.on('mouse:down', (o) => {
      const tool = window.CANVAS_ACTIVE_TOOL || 'select';
      if (tool === 'select') return;
      
      canvas.discardActiveObject();
      const pointer = canvas.getPointer(o.e);
      isDrawingShape = true;
      origX = pointer.x;
      origY = pointer.y;

      if (tool === 'rect') {
        tempShape = new fabric.Rect({
          left: origX,
          top: origY,
          originX: 'left',
          originY: 'top',
          width: 0,
          height: 0,
          fill: 'transparent',
          stroke: 'black',
          strokeWidth: 2,
          selectable: false,
          id: uuidv4()
        });
        canvas.add(tempShape);
      } else if (tool === 'circle') {
        tempShape = new fabric.Circle({
          left: origX,
          top: origY,
          originX: 'center',
          originY: 'center',
          radius: 0,
          fill: 'transparent',
          stroke: 'black',
          strokeWidth: 2,
          selectable: false,
          id: uuidv4()
        });
        canvas.add(tempShape);
      }
    });

    canvas.on('mouse:move', (o) => {
      if (!isDrawingShape || !tempShape) return;
      const pointer = canvas.getPointer(o.e);
      const tool = window.CANVAS_ACTIVE_TOOL || 'select';

      if (tool === 'rect') {
        if (origX > pointer.x) {
          tempShape.set({ left: Math.abs(pointer.x) });
        }
        if (origY > pointer.y) {
          tempShape.set({ top: Math.abs(pointer.y) });
        }
        tempShape.set({ width: Math.abs(origX - pointer.x) });
        tempShape.set({ height: Math.abs(origY - pointer.y) });
      } else if (tool === 'circle') {
        const radius = Math.max(Math.abs(origY - pointer.y), Math.abs(origX - pointer.x)) / 2;
        tempShape.set({ radius: radius });
      }
      canvas.renderAll();
    });

    canvas.on('mouse:up', (o) => {
      if (isDrawingShape && tempShape) {
        isDrawingShape = false;
        tempShape.setCoords();
        tempShape.set({ selectable: true });
        socket.emit('canvas_update', { roomCode, objectData: tempShape.toJSON(['id']) });
        tempShape = null;
        window.CANVAS_ACTIVE_TOOL = 'select'; // auto-revert to select tool
      }
    });

    // ── ROOPAK'S DELETE HANDLER ──────────────────────────────────
    const handleKeyDown = (e) => {
      if (e.key === 'Delete' || e.key === 'Backspace') {
        const activeObjects = canvas.getActiveObjects();
        if (activeObjects.length > 0) {
          if (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA') return;
          e.preventDefault();
          activeObjects.forEach(obj => canvas.remove(obj));
          canvas.discardActiveObject();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);

    // ── RECEIVE SIDE ─────────────────────────────────────────────
    socket.on('canvas_update', (data) => {
      isReceivingUpdate.current = true;
      const existing = canvas.getObjects().find(o => o.id === data.objectData.id);
      if (existing) {
        try {
          existing.set(data.objectData);
          existing.setCoords();
          canvas.renderAll();
        } finally {
          isReceivingUpdate.current = false;
        }
      } else {
        fabric.util.enlivenObjects([data.objectData], (objects) => {
          try {
            objects.forEach(obj => canvas.add(obj));
            canvas.renderAll();
          } finally {
            isReceivingUpdate.current = false;
          }
        });
      }
    });

    socket.on('canvas_delete', (data) => {
      isReceivingUpdate.current = true;
      const obj = canvas.getObjects().find(o => o.id === data.objectId);
      if (obj) { canvas.remove(obj); canvas.renderAll(); }
      isReceivingUpdate.current = false;
    });

    // ── PHASE 3: HIMANSHU ADDS LOCKING LISTENERS HERE ────────────
    // selection:created, selection:cleared, selection:updated
    // lock_acquired, lock_released, user_disconnected_locks_cleared

    // ── PHASE 4: HIMANSHU ADDS ai_image_generated LISTENER HERE ──

    // ── PHASE 5: HIMANSHU ADDS loadBoard() CALL HERE ─────────────

    return () => {
      throttledMove.cancel();
      window.removeEventListener('keydown', handleKeyDown);
      socket.disconnect();
      canvas.dispose();
    };
  }, [roomCode]);

  // ── PHASE 5: HIMANSHU WIRES handleSave HERE ───────────────────
  const handleSave = async () => { /* Himanshu implements Phase 5 */ };

  return (
    <div>
      <canvas id="canvas-el" width={1200} height={700} />
      <button onClick={handleSave}>Save Board</button>
    </div>
  );
};

export default Canvas;
