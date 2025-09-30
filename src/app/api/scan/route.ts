import { NextRequest } from 'next/server';
import { ScanOrchestrator } from '@/modules/scanning/scan-orchestrator';

/**
 * POST /api/scan
 * Server-Sent Events (SSE) ile real-time log streaming
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { credentials, limitProjects, limitTargets, cacheMaxAgeMs } = body as {
      credentials?: { orgId: string; apiKey: string; limitProjects?: number; limitTargets?: number };
      limitProjects?: number;
      limitTargets?: number;
      cacheMaxAgeMs?: number;
    };

    // Credentials kontrolü
    if (!credentials || !credentials.orgId || !credentials.apiKey) {
      return new Response(
        JSON.stringify({ error: 'Unity Cloud Build credentials eksik veya geçersiz' }),
        { 
          status: 401,
          headers: { 'Content-Type': 'application/json' }
        }
      );
    }

    // SSE Stream oluştur
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        // SSE event gönderme helper fonksiyonu
        const sendEvent = (eventType: string, data: any) => {
          const message = `event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`;
          controller.enqueue(encoder.encode(message));
        };

        try {
          // ScanOrchestrator oluştur
          const orchestrator = new ScanOrchestrator();

          // Log callback - her log'u stream'e gönder
          orchestrator.setLogCallback((level, message, source) => {
            sendEvent('log', {
              level,
              message,
              source,
              timestamp: new Date().toISOString()
            });
          });

          // Progress callback - ilerlemeyi stream'e gönder
          orchestrator.setProgressCallback((progress) => {
            sendEvent('progress', progress);
          });

          // Scan başlat
          const result = await orchestrator.startScan({
            credentials,
            limitProjects,
            limitTargets,
            cacheMaxAgeMs
          });

          // Tamamlama event'i gönder
          sendEvent('complete', {
            results: result.results,
            summary: result.summary
          });

        } catch (error) {
          // Error event'i gönder
          sendEvent('error', {
            message: error instanceof Error ? error.message : String(error)
          });
        } finally {
          // Stream'i kapat
          controller.close();
        }
      }
    });

    // SSE response dön
    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });

  } catch (error) {
    console.error('Scan API Error:', error);
    return new Response(
      JSON.stringify({
        error: 'Scan işlemi başarısız',
        details: error instanceof Error ? error.message : String(error)
      }),
      { 
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      }
    );
  }
}
