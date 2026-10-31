import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

/** Gives every request an id (or keeps the caller's) and logs one structured line per request. */
export class RequestIdMiddleware {
  use = (req: Request, res: Response, next: NextFunction) => {
    const incoming = req.header('x-request-id');
    const id = incoming && /^[\w-]{8,64}$/.test(incoming) ? incoming : randomUUID();
    res.setHeader('x-request-id', id);
    const started = process.hrtime.bigint();
    res.on('finish', () => {
      const ms = Number(process.hrtime.bigint() - started) / 1e6;
      // Never log bodies or query strings: they can carry PINs and codes.
      console.log(JSON.stringify({ level: 'info', requestId: id, method: req.method, path: req.path, status: res.statusCode, ms: Math.round(ms) }));
    });
    next();
  };
}
