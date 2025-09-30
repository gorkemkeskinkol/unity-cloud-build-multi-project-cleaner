import { NextRequest, NextResponse } from 'next/server';
import { DatabaseService } from '@/modules/database/database-service';

/**
 * DELETE /api/cache/[projectId]
 * Tek bir projenin cache'ini temizler
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: { projectId: string } }
) {
  try {
    const { projectId } = params;

    if (!projectId) {
      return NextResponse.json(
        { error: 'Project ID gerekli' },
        { status: 400 }
      );
    }

    const db = DatabaseService.getInstance();
    await db.clearProjectCache(projectId);

    return NextResponse.json({
      success: true,
      message: `Proje cache'i temizlendi: ${projectId}`
    });
  } catch (error) {
    console.error('Cache temizleme hatası:', error);
    return NextResponse.json(
      { 
        error: 'Cache temizlenirken hata oluştu',
        details: error instanceof Error ? error.message : String(error)
      },
      { status: 500 }
    );
  }
}
