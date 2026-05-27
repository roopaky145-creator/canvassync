import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { io } from 'socket.io-client';
import { v4 as uuidv4 } from 'uuid';
import { throttle } from 'lodash';
import { fabric } from 'fabric';

import Toolbar from '../components/Toolbar';

const Canvas = () => {
  const { code: roomCode } = useParams();
  const [activeTool, setActiveTool] = useState('select');
  const [brushColor, setBrushColor] = useState('#000000');
  const [brushWidth, setBrushWidth] = useState(2);
  const canvasRef = useRef(null);        // Needed by handleSave in Phase 5
  const isReceivingUpdate = useRef(false); // Prevents infinite broadcast loops
  const socketRef = useRef(null);         // Exposed for Phase 4 AI panel

  useEffect(() => {
    if (canvasRef.current) {
      canvasRef.current.isDrawingMode = (activeTool === 'pen');
      if (activeTool === 'pen') {
        canvasRef.current.freeDrawingBrush.color = brushColor;
        canvasRef.current.freeDrawingBrush.width = brushWidth;
      }
      window.CANVAS_ACTIVE_TOOL = activeTool;
    }
  }, [brushColor, brushWidth, activeTool]);

  useEffect(() => {
    const socket = io(process.env.REACT_APP_BACKEND_URL);
    socketRef.current = socket;
    const canvas = new fabric.Canvas('canvas-el');
    canvasRef.current = canvas;

    socket.emit('join_room', roomCode);

    // ── EMIT SIDE ────────────────────────────────────────────────
    canvas.on('object:added', (e) => {
      if (!e.target.id) e.target.set('id', uuidv4());
      if (!isReceivingUpdate.current && !isDrawingShape) {
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

    canvas.on('path:created', (e) => {
      if (!e.path.id) e.path.set('id', uuidv4());
    });

    canvas.on('mouse:down', (e) => {
      if (window.CANVAS_ACTIVE_TOOL === 'eraser' && e.target) {
        if (!e.target.id) return; // Guard against unsynced objects
        canvas.remove(e.target);
      }
    });

    // ── ROOPAK'S SHAPE DRAWING LOGIC ─────────────────────────────
    const supportedDrawingTools = new Set(['rect', 'circle']);
    let isDrawingShape = false;
    let drawingTool = null;
    let origX = 0;
    let origY = 0;
    let tempShape = null;

    canvas.on('mouse:down', (o) => {
      const tool = window.CANVAS_ACTIVE_TOOL || 'select';
      if (!supportedDrawingTools.has(tool)) return;

      canvas.discardActiveObject();
      const pointer = canvas.getPointer(o.e);

      isDrawingShape = true;
      drawingTool = tool;
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
      } else {
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
      }

      canvas.add(tempShape);
    });

    canvas.on('mouse:move', (o) => {
      if (!isDrawingShape || !tempShape) return;

      const pointer = canvas.getPointer(o.e);
      const dx = pointer.x - origX;
      const dy = pointer.y - origY;

      if (drawingTool === 'rect') {
        tempShape.set({
          left: Math.min(origX, pointer.x),
          top: Math.min(origY, pointer.y),
          width: Math.abs(dx),
          height: Math.abs(dy)
        });
      } else if (drawingTool === 'circle') {
        tempShape.set({
          left: origX + dx / 2,
          top: origY + dy / 2,
          radius: Math.max(Math.abs(dx), Math.abs(dy)) / 2
        });
      }

      tempShape.setCoords();
      canvas.renderAll();
    });

    canvas.on('mouse:up', () => {
      if (!isDrawingShape || !tempShape) return;

      isDrawingShape = false;

      const isZeroSize =
        (tempShape.type === 'rect' && (tempShape.width < 2 || tempShape.height < 2)) ||
        (tempShape.type === 'circle' && tempShape.radius < 2);

      if (isZeroSize) {
        isReceivingUpdate.current = true;
        canvas.remove(tempShape);
        isReceivingUpdate.current = false;
      } else {
        tempShape.setCoords();
        tempShape.set({ selectable: true });
        socket.emit('canvas_update', { roomCode, objectData: tempShape.toJSON(['id']) });
      }

      tempShape = null;
      drawingTool = null;
      window.CANVAS_ACTIVE_TOOL = 'select';
      setActiveTool('select');
    });

    // ── ROOPAK'S DELETE HANDLER ──────────────────────────────────
    const handleKeyDown = (e) => {
      if (e.key === 'Delete' || e.key === 'Backspace') {
        const activeObjects = canvas.getActiveObjects();
        if (activeObjects.length > 0) {
          if (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA') return;
          e.preventDefault();
          canvas.discardActiveObject();
          activeObjects.forEach(obj => canvas.remove(obj));
          canvas.renderAll();
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
      <Toolbar 
        activeTool={activeTool} 
        setActiveTool={setActiveTool} 
        brushColor={brushColor} 
        setBrushColor={setBrushColor} 
        brushWidth={brushWidth} 
        setBrushWidth={setBrushWidth} 
      />
      <canvas id="canvas-el" width={1200} height={700} />
      <button onClick={handleSave}>Save Board</button>
    </div>
  );
};

export default Canvas;
