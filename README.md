# CanvasSync

**A real-time, distributed collaborative whiteboard with integrated AI image generation and persistent state management.**

CanvasSync is a multi-user, real-time digital whiteboard application. It enables teams to draw, add shapes, type text, and generate AI-powered images directly onto a shared canvas workspace. Changes are synchronized instantly across all connected clients via WebSockets, ensuring a seamless, low-latency collaborative experience.

Beyond basic drawing capabilities, CanvasSync is engineered to solve complex distributed systems challenges like out-of-order event hydration, race conditions during asynchronous media generation, and granular lock management to prevent concurrent editing conflicts. The board state is persisted to a MongoDB backend, meaning teams can seamlessly drop in and out of rooms at any time without losing their work.

---

## Key Features

- **Real-Time Collaboration**: Instant synchronization of drawings, object manipulations, and state changes via Socket.io.
- **Rich Canvas Toolset**: Pen drawing, geometric shapes (rectangles, circles, lines), text insertion, and a targeted eraser.
- **AI Canvas Generator**: Integrated Hugging Face Inference API for generating AI images directly onto the canvas from text prompts.
- **Granular Object Locking**: Prevents editing conflicts by locking objects (providing visual transparency and stroke cues) when another user is actively modifying them.
- **Transient Ledger & State Hydration**: A robust event buffering system that perfectly reconstructs board state for late-joining clients, even if the primary database hasn't been saved yet.
- **Undo/Redo Stack**: Robust user-action history management.
- **Persistent Rooms**: Dedicated Lobby UI for creating and joining specific collaborative rooms, with canvas state saved to MongoDB.

---

## Tech Stack

**Frontend**
- React 19
- React Router DOM v7
- Fabric.js (v5.3.0 - Canvas Engine)
- Lucide React (Icons)

**Backend**
- Node.js & Express 5
- Socket.io (Real-time engine)
- MongoDB / Mongoose (Database)
- Hugging Face Inference API (`@huggingface/inference`)

---

## Local Setup & Installation

### 1. Clone the repository
```bash
git clone <repository-url>
cd canvassync
```

### 2. Install dependencies
Install packages for both the client and the server:
```bash
# Install Server Dependencies
cd server
npm install

# Install Client Dependencies
cd ../client
npm install
```

### 3. Environment Configuration
You will need to create two `.env` files.

**Server (`server/.env`):**
```env
PORT=3001
FRONTEND_URL=http://localhost:3000
MONGO_URI=your_mongodb_connection_string
AI_API_KEY=your_huggingface_api_key
# Optional AI overrides:
# AI_IMAGE_MODEL=...
# AI_PROVIDER=auto
# AI_TIMEOUT_MS=30000
```

**Client (`client/.env`):**
```env
REACT_APP_BACKEND_URL=http://localhost:3001
```

### 4. Run the Development Servers

Open two terminal windows to run both servers concurrently.

**Terminal 1 (Backend):**
```bash
cd server
npm start
```

**Terminal 2 (Frontend):**
```bash
cd client
npm start
```
The application will be accessible at `http://localhost:3000`.

---

## Architecture & Engineering Deep Dive

Building a collaborative canvas application is notoriously difficult due to the complexities of distributed state. CanvasSync employs several advanced engineering patterns to guarantee consistency across all clients.

### Distributed State Synchronization
To ensure all clients see the exact same canvas state, the Node.js server acts as the central router for WebSockets. Because relying solely on database snapshots is too slow for real-time collaboration, we employ a **"Transient Ledger"** architecture. Every operation (draws, moves, AI generations) that happens between hard database saves is recorded in server memory. When a "late-joiner" connects to a room, they fetch the last known MongoDB state and then hydrate their local canvas by "replaying" the transient ledger chronologically.

### Event Ordering & Watermarks
Networks are unpredictable; events sent in order `[A, B, C]` might arrive as `[C, A, B]`. To solve this without visually glitching the canvas, we implemented a **contiguous-prefix sequence tracker (watermarking)**. The backend assigns a strictly incrementing `eventId` to every action. The React client maintains an internal event buffer and only flushes updates to the Fabric.js canvas when it can mathematically guarantee chronological ordering (e.g., waiting for event 5 before rendering event 6).

### Asynchronous Hydration & Race Conditions
One of the most complex engineering challenges involved integrating AI Image Generation. Because `fabric.Image.fromURL` is highly asynchronous (waiting on Base64 image decoding), live WebSocket lock events or coordinate updates could arrive for an image that wasn't yet fully instantiated on the DOM. 

To solve this, we implemented deep buffering strategies (`pendingImagePositionsRef` and `pendingLocksRef`). If a lock event arrives for a missing object, the client assumes the object is mid-render and safely queues the state modifications against the object's UUID. Inside the asynchronous `fromURL` callback, right after the image is finally constructed, the client instantly queries the buffer and applies any missing locks or coordinates *before* the final render loop. This completely eliminates "ghost image" race conditions, dropped locks, and visual desyncs.
