import { NextResponse } from 'next/server';
import { DatabaseService } from '@/modules/database/database-service';

export async function GET() {
  try {
    const db = DatabaseService.getInstance();
    // 1 hafta = 7 gün * 24 saat * 60 dakika * 60 saniye * 1000 ms
    const oneWeekMs = 7 * 24 * 60 * 60 * 1000; // 604800000ms
    const projects = await db.getAllCachedProjects(oneWeekMs);
    
    return NextResponse.json(projects);
  } catch (error) {
    console.error('Error fetching cached projects:', error);
    return NextResponse.json(
      { error: 'Failed to fetch cached projects' },
      { status: 500 }
    );
  }
}
