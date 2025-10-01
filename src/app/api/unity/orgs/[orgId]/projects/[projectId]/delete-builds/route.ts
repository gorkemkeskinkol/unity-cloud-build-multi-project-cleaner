import { NextRequest, NextResponse } from 'next/server';
import { UnityCloudBuildService } from '@/modules/api/unity-cloud-build';
import { CredentialManager } from '@/modules/config/credential-manager';

export async function DELETE(
  request: NextRequest,
  { params }: { params: { orgId: string; projectId: string } }
) {
  try {
    const { orgId, projectId } = params;

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
    
    const stream = new ReadableStream({
      async start(controller) {
        try {
          // Log event gönder
          const sendLog = (level: string, message: string, source: string = 'DeleteBuilds') => {
            const data = JSON.stringify({ level, message, source });
            controller.enqueue(encoder.encode(`event: log\ndata: ${data}\n\n`));
          };

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
            sendLog('warning', `${result.deletedTargets}/${result.totalTargets} target'ın artifact'leri silindi`, 'DeleteBuilds');
            result.errors.forEach(err => {
              sendLog('error', `${err.targetName}: ${err.error}`, 'DeleteBuilds');
            });
          } else {
            sendLog('success', `✓ Tüm artifact'ler başarıyla silindi (${result.deletedTargets} target)`, 'DeleteBuilds');
          }

          // Cache güncelleme
          if (updateCache) {
            sendLog('info', 'Cache güncelleniyor...', 'DeleteBuilds');
            
            try {
              // Cache'i temizle
              const cacheResponse = await fetch(
                `${request.nextUrl.origin}/api/cache/${projectId}`,
                { method: 'DELETE' }
              );

              if (cacheResponse.ok) {
                sendLog('success', '✓ Cache temizlendi', 'DeleteBuilds');
              } else {
                sendLog('warning', 'Cache temizleme başarısız', 'DeleteBuilds');
              }
            } catch (cacheError) {
              sendLog('warning', `Cache güncelleme hatası: ${cacheError}`, 'DeleteBuilds');
            }
          }

          // Complete event
          const completeData = JSON.stringify({
            deletedTargets: result.deletedTargets,
            totalTargets: result.totalTargets,
            errors: result.errors,
            cacheUpdated: updateCache
          });
          controller.enqueue(encoder.encode(`event: complete\ndata: ${completeData}\n\n`));

          controller.close();
        } catch (error) {
          console.error('[DELETE_BUILDS_API] Error:', error);
          
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
          const errorData = JSON.stringify({ message: errorMessage });
          controller.enqueue(encoder.encode(`event: error\ndata: ${errorData}\n\n`));
          controller.close();
        }
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
