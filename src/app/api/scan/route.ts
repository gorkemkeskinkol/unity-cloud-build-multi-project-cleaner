import { NextRequest, NextResponse } from 'next/server';
import { ScanOrchestrator } from '@/modules/scanning/scan-orchestrator';
import { CredentialManager } from '@/modules/config/credential-manager';

/**
 * POST /api/scan
 * Server-side scan endpoint - Prisma client server'da çalışır
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
      return NextResponse.json(
        { error: 'Unity Cloud Build credentials eksik veya geçersiz' },
        { status: 401 }
      );
    }

    // Log collector için array
    const logs: Array<{
      level: 'info' | 'warning' | 'error' | 'success';
      message: string;
      source?: string;
      timestamp: string;
    }> = [];

    // ScanOrchestrator oluştur
    const orchestrator = new ScanOrchestrator();

    // Log callback
    orchestrator.setLogCallback((level, message, source) => {
      logs.push({
        level,
        message,
        source,
        timestamp: new Date().toISOString()
      });
    });

    // Scan başlat - credentials'ı geç
    const result = await orchestrator.startScan({
      credentials,
      limitProjects,
      limitTargets,
      cacheMaxAgeMs
    });

    return NextResponse.json({
      success: true,
      results: result.results,
      summary: result.summary,
      logs
    });

  } catch (error) {
    console.error('Scan API Error:', error);
    return NextResponse.json(
      {
        error: 'Scan işlemi başarısız',
        details: error instanceof Error ? error.message : String(error)
      },
      { status: 500 }
    );
  }
}
