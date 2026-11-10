import { NextResponse } from 'next/server';
import { DatabaseService } from '@/modules/database/database-service';
import { DEFAULT_CACHE_MAX_AGE_MS } from '@/modules/config/cache-config';

export async function GET() {
  try {
    const db = DatabaseService.getInstance();
    const projects = await db.getAllCachedProjects(DEFAULT_CACHE_MAX_AGE_MS);
    
    return NextResponse.json(projects);
  } catch (error) {
    console.error('Error fetching cached projects:', error);
    return NextResponse.json(
      { error: 'Failed to fetch cached projects' },
      { status: 500 }
    );
  }
}
