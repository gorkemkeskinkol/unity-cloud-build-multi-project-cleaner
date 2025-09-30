import { NextRequest, NextResponse } from 'next/server';
import { DatabaseService } from '@/modules/database/database-service';

/**
 * POST /api/cache/bulk
 * Çoklu projenin cache'ini temizler
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { projectIds } = body as { projectIds: string[] };

    if (!projectIds || !Array.isArray(projectIds) || projectIds.length === 0) {
      return NextResponse.json(
        { error: 'projectIds array gerekli' },
        { status: 400 }
      );
    }

    const db = DatabaseService.getInstance();
    await db.bulkClearProjectsCache(projectIds);

    return NextResponse.json({
      success: true,
      message: `${projectIds.length} projenin cache'i temizlendi`,
      clearedCount: projectIds.length
    });
  } catch (error) {
    console.error('Bulk cache temizleme hatası:', error);
    return NextResponse.json(
      { 
        error: 'Bulk cache temizlenirken hata oluştu',
        details: error instanceof Error ? error.message : String(error)
      },
      { status: 500 }
    );
  }
}
