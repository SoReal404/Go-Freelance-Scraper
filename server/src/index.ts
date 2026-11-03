import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { authRouter } from './routes/auth.js';
import { projectsRouter } from './routes/projects.js';
import { bidsRouter } from './routes/bids.js';
import { setupSocket } from './socket.js';
import { startWatcher } from './watcher.js';

const app = express();
const httpServer = createServer(app);

const io = new Server(httpServer, {
  cors: {
    origin: ['http://localhost:3000', 'http://127.0.0.1:3000'],
    credentials: true,
  },
});

app.use(cors({ origin: ['http://localhost:3000', 'http://127.0.0.1:3000'], credentials: true }));
app.use(express.json());

// Routes
app.use('/api/auth', authRouter);
app.use('/api/projects', projectsRouter);
app.use('/api/bids', bidsRouter);

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, time: new Date().toISOString(), uptime: process.uptime() });
});

// Real-time + file watcher
setupSocket(io);
startWatcher(io);

const PORT = Number(process.env.PORT) || 3001;
httpServer.listen(PORT, () => {
  console.log(`\n🚀 GO Freelance server running on http://localhost:${PORT}`);
  console.log(`📁 Watching worker data for new projects...\n`);
});
