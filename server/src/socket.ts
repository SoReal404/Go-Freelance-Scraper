import { Server, Socket } from 'socket.io';
import { projectsStore } from './watcher.js';

export function setupSocket(io: Server) {
  io.on('connection', (socket: Socket) => {
    console.log(`[Socket] Client connected: ${socket.id}`);

    // Send the last 100 projects on connect
    socket.emit('projects:initial', projectsStore.slice(0, 100));

    socket.on('disconnect', () => {
      console.log(`[Socket] Client disconnected: ${socket.id}`);
    });

    socket.on('subscribe', (filters: { platforms?: string[] }) => {
      // Store filter preferences on socket for future targeted broadcasts
      (socket as unknown as Record<string, unknown>).filters = filters;
    });
  });
}
