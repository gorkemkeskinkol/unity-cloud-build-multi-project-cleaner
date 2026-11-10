import { NextRequest, NextResponse } from 'next/server';
import { JobStore } from '@/modules/jobs/job-store';

/**
 * GET /api/jobs/[id] → job + item listesi
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const store = new JobStore();
  const job = await store.getJob(id);
  if (!job) {
    return NextResponse.json({ error: 'Job bulunamadı' }, { status: 404 });
  }
  const items = await store.getItems(id);
  return NextResponse.json({ job, items });
}
