import { NextRequest, NextResponse } from 'next/server';
import { UnityCloudBuildService } from '@/modules/api/unity-cloud-build';
import { ApiError, describeWait } from '@/modules/api/api-client';
import { CredentialManager } from '@/modules/config/credential-manager';

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ orgId: string; projectId: string }> }
) {
  try {
    const { orgId, projectId } = await params;

    // Get credentials from request headers
    const apiKey = request.headers.get('x-api-key');
    
    if (!apiKey) {
      return NextResponse.json(
        { error: 'API key is required' },
        { status: 401 }
      );
    }

    // Validate credentials format
    if (!CredentialManager.validateOrgIdFormat(orgId)) {
      return NextResponse.json(
        { error: 'Invalid organization ID format' },
        { status: 400 }
      );
    }

    if (!CredentialManager.validateApiKeyFormat(apiKey)) {
      return NextResponse.json(
        { error: 'Invalid API key format' },
        { status: 400 }
      );
    }

    // Parse optional parameters from request body
    const body = await request.json().catch(() => ({}));
    const { updateCache = true } = body;

    // Create Unity Cloud Build service instance
    const unityService = new UnityCloudBuildService(orgId, apiKey);

    console.log(`[DELETE_BUILDS_API] Starting deletion for project ${projectId}`);

    // SSE için encoder
    const encoder = new TextEncoder();
    
    // Tarayıcı bağlantıyı koparırsa süren rate limit beklemeleri kesilir
    let clientGone = false;
    request.signal.addEventListener('abort', () => {
      clientGone = true;
      console.warn('[DELETE_BUILDS_API] İstemci bağlantıyı kopardı, bekleyen işlemler iptal ediliyor');
    });
    unityService.setCancelCheck(() => clientGone);

    const stream = new ReadableStream({
      async start(controller) {
        let closed = false;
        const send = (eventType: string, payload: unknown) => {
          if (closed) return;
          try {
            controller.enqueue(encoder.encode(`event: ${eventType}\ndata: ${JSON.stringify(payload)}\n\n`));
          } catch (error) {
            closed = true;
            console.error('SSE send error:', error);
          }
        };
        const close = () => {
          if (closed) return;
          closed = true;
          try { controller.close(); } catch { /* zaten kapalı */ }
        };
        // Log event gönder
        const sendLog = (level: string, message: string, source: string = 'DeleteBuilds') => {
          send('log', { level, message, source });
        };

        try {
          // Rate limit / geçici hata beklemeleri kullanıcıya anında bildirilsin
          unityService.setWaitCallback((info) => {
            sendLog('warning', describeWait(info), 'DeleteBuilds');
          });

          sendLog('info', `Proje ${projectId} için artifact silme işlemi başlatılıyor...`, 'DeleteBuilds');

          // Artifact'leri sil
          const result = await unityService.deleteAllBuildsForProject(
            projectId,
            (current, total, targetName) => {
              sendLog('info', `Deleting artifacts for ${targetName} (${current}/${total})...`, 'DeleteBuilds');
            }
          );

          // Sonuç logları
          if (result.errors.length > 0) {
            sendLog('warning', `${result.deletedTargets}/${result.totalTargets} target artifact silindi`, 'DeleteBuilds');
            result.errors.forEach(err => {
              sendLog('error', `${err.targetName}: ${err.error}`, 'DeleteBuilds');
            });
          } else {
            sendLog('success', `✓ Tüm artifactler başarıyla silindi (${result.deletedTargets} target)`, 'DeleteBuilds');
          }

          // Cache güncelleme
          if (updateCache) {
            sendLog('info', 'Cache güncelleniyor...', 'DeleteBuilds');
            
            try {
              // Önce cachei temizle
              const cacheResponse = await fetch(
                `${request.nextUrl.origin}/api/cache/${projectId}`,
                { method: 'DELETE' }
              );

              if (cacheResponse.ok) {
                sendLog('success', '✓ Cache temizlendi', 'DeleteBuilds');
                
                // Projeyi tekrar tara ve cachee geri ekle
                sendLog('info', "Proje cachee tekrar ekleniyor...", 'DeleteBuilds');
                
                try {
                  const { ScanOrchestrator } = await import('@/modules/scanning/scan-orchestrator');
                  const orchestrator = new ScanOrchestrator();
                  
                  // Log callback'ini ayarla
                  orchestrator.setLogCallback((level, message, source) => {
                    sendLog(level, message, source || 'DeleteBuilds');
                  });
                  
                  // Tek proje taraması yap
                  const scanResult = await orchestrator.scanSingleProject(projectId, {
                    orgId,
                    apiKey,
                    projectName: result.deletedTargets > 0 ? undefined : projectId
                  });
                  
                  sendLog('success', `✓ Proje güncel bilgilerle cachee eklendi (${scanResult.totalBuilds} builds)`, 'DeleteBuilds');
                } catch (rescanError) {
                  const rescanErrorMsg = rescanError instanceof Error ? rescanError.message : String(rescanError);
                  sendLog('warning', `Proje cachee eklenemedi: ${rescanErrorMsg}`, 'DeleteBuilds');
                  sendLog('info', "Manuel scan yaparak projeyi cachee ekleyebilirsiniz", 'DeleteBuilds');
                }
              } else {
                sendLog('warning', 'Cache temizleme başarısız', 'DeleteBuilds');
              }
            } catch (cacheError) {
              sendLog('warning', `Cache güncelleme hatası: ${cacheError}`, 'DeleteBuilds');
            }
          }

          // Complete event
          send('complete', {
            deletedTargets: result.deletedTargets,
            totalTargets: result.totalTargets,
            errors: result.errors,
            cacheUpdated: updateCache
          });
          close();
        } catch (error) {
          console.error('[DELETE_BUILDS_API] Error:', error);

          const errorMessage = error instanceof ApiError
            ? `${error.describe()} - silme işlemi durduruldu, hiçbir target atlanmadı; daha sonra tekrar deneyin`
            : (error instanceof Error ? error.message : 'Unknown error');
          sendLog('error', errorMessage, 'DeleteBuilds');
          send('error', { message: errorMessage });
          close();
        }
      },
      cancel() {
        clientGone = true;
      }
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });

  } catch (error) {
    console.error('[DELETE_BUILDS_API] Setup error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error occurred';
    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}
