/**
 * Tiny ephemeral-port helper used by runtime tests so parallel tests don't
 * collide on a single hard-coded port. Opens a server on port 0, reads the
 * OS-assigned port, closes immediately.
 */
import * as net from 'node:net';

export function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      if (typeof addr === 'object' && addr) {
        const port = addr.port;
        srv.close(() => resolve(port));
      } else {
        srv.close(() => reject(new Error('no addr')));
      }
    });
  });
}
