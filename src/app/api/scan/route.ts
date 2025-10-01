import { NextRequest } from 'next/server';
import { ScanOrchestrator } from '@/modules/scanning/scan-orchestrator';

/**
 * POST /api/scan
 * Server-Sent Events (SSE) ile real-time log streaming
 */
export async function POST(request: NextRequest) {
  // Önce body'yi oku ve değişkene kaydet
  let requestBody;
  try {
    requestBody = await request.json();
  } catch (error) {
    return new Response(
      JSON.stringify({ error: 'Invalid request body' }),
      { 
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      }
    );
  }

  const { credentials, limitProjects, limitTargets, cacheMaxAgeMs } = requestBody as {
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
        try {
          const message = `event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`;
          controller.enqueue(encoder.encode(message));
        } catch (error) {
          console.error('SSE send error:', error);
        }
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
        console.error('Scan error:', error);
        sendEvent('error', {
          message: error instanceof Error ? error.message : String(error)
        });
      } finally {
        // Stream'i kapat
        try {
          controller.close();
        } catch (error) {
          console.error('Stream close error:', error);
        }
      }
    }
  });

  // SSE response dön
  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no', // Nginx buffering'i devre dışı bırak
    },
  });
}
