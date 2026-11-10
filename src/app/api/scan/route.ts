import { NextRequest } from 'next/server';
import { ScanOrchestrator } from '@/modules/scanning/scan-orchestrator';
import { getActiveScan, registerActiveScan, clearActiveScan } from '@/modules/scanning/scan-registry';
import { ApiClient } from '@/modules/api/api-client';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

/**
 * GET /api/scan
 * Aktif scan var mı? Sayfa yenilendiğinde UI'ın durumu göstermesi için.
 */
export async function GET() {
  const active = getActiveScan();
  return json({
    isScanning: !!active,
    startedAt: active?.startedAt ?? null,
    progress: active?.orchestrator.getScanProgress() ?? null,
    rateLimitBlockMs: ApiClient.remainingBlockMs()
  });
}

/**
 * DELETE /api/scan
 * Aktif scan'i iptal et. Süren bekleme en geç 1 sn içinde kesilir.
 */
export async function DELETE() {
  const active = getActiveScan();
  if (!active) {
    return json({ cancelled: false, error: 'Aktif scan yok' }, 404);
  }
  active.orchestrator.cancelScan();
  return json({ cancelled: true });
}

/**
 * POST /api/scan
 * Server-Sent Events (SSE) ile real-time log streaming
 */
export async function POST(request: NextRequest) {
  let requestBody;
  try {
    requestBody = await request.json();
  } catch {
    return json({ error: 'Invalid request body' }, 400);
  }

  const { credentials, limitProjects, limitTargets, cacheMaxAgeMs, maxPasses } = requestBody as {
    credentials?: { orgId: string; apiKey: string; limitProjects?: number; limitTargets?: number };
    limitProjects?: number;
    limitTargets?: number;
    cacheMaxAgeMs?: number;
    maxPasses?: number;
  };

  if (!credentials || !credentials.orgId || !credentials.apiKey) {
    return json({ error: 'Unity Cloud Build credentials eksik veya geçersiz' }, 401);
  }

  // Aynı anda tek scan: ikincisi rate limit'i tetikler
  const orchestrator = new ScanOrchestrator();
  if (!registerActiveScan(orchestrator)) {
    const active = getActiveScan();
    return json({
      error: 'Zaten bir scan işlemi devam ediyor. Bitmesini bekleyin veya iptal edin.',
      startedAt: active?.startedAt ?? null
    }, 409);
  }

  // Tarayıcı bağlantıyı koparırsa (sekme kapandı, sayfa yenilendi) scan'i durdur;
  // kimse izlemiyorken Unity'yi yoklamaya devam etmenin anlamı yok.
  request.signal.addEventListener('abort', () => {
    console.warn('[SCAN] İstemci bağlantıyı kopardı, scan iptal ediliyor');
    orchestrator.cancelScan();
  });

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;
      const sendEvent = (eventType: string, data: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch (error) {
          closed = true;
          console.error('SSE send error:', error);
        }
      };

      try {
        orchestrator.setLogCallback((level, message, source) => {
          sendEvent('log', { level, message, source, timestamp: new Date().toISOString() });
        });
        orchestrator.setProgressCallback((progress) => {
          sendEvent('progress', progress);
        });

        const result = await orchestrator.startScan({
          credentials,
          limitProjects,
          limitTargets,
          cacheMaxAgeMs,
          maxPasses
        });

        sendEvent('complete', { results: result.results, summary: result.summary });
      } catch (error) {
        console.error('Scan error:', error);
        sendEvent('error', { message: error instanceof Error ? error.message : String(error) });
      } finally {
        clearActiveScan(orchestrator);
        if (!closed) {
          try {
            controller.close();
          } catch (error) {
            console.error('Stream close error:', error);
          }
        }
      }
    },
    cancel() {
      // Okuyucu stream'i bıraktı
      orchestrator.cancelScan();
      clearActiveScan(orchestrator);
    }
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no'
    }
  });
}
