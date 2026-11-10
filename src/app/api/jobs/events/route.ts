import { NextRequest } from 'next/server';
import { getJobEventBus } from '@/modules/jobs/job-events';
import { getJobRunner } from '@/modules/jobs/job-runner';

export const dynamic = 'force-dynamic';

/**
 * GET /api/jobs/events
 * SSE: önce son logların arşivi, sonra canlı log ve job güncellemeleri.
 * Tarayıcı EventSource ile bağlanır; bağlantı koparsa otomatik yeniden bağlanır.
 */
export async function GET(request: NextRequest) {
  await getJobRunner().boot();
  const bus = getJobEventBus();
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      let closed = false;
      const send = (event: string, data: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          closed = true;
        }
      };

      // Geç bağlanan istemci son logları görsün
      send('backlog', bus.getBacklog());

      const unsubscribe = bus.subscribe((event) => {
        send(event.kind, event);
      });

      // Proxy'lerin bağlantıyı kapatmaması için nabız
      const heartbeat = setInterval(() => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`: ping\n\n`));
        } catch {
          closed = true;
        }
      }, 15000);

      const cleanup = () => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        unsubscribe();
        try { controller.close(); } catch { /* zaten kapalı */ }
      };

      request.signal.addEventListener('abort', cleanup);
    },
    cancel() {
      // okuyucu bıraktı; abort listener temizler
    }
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no'
    }
  });
}
