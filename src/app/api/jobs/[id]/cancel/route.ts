import { NextRequest, NextResponse } from 'next/server';
import { getJobRunner } from '@/modules/jobs/job-runner';

/**
 * POST /api/jobs/[id]/cancel
 * Çalışan iş: süren bekleme en geç 1 sn içinde kesilir. Sıradaki iş: sıradan çıkarılır.
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const cancelled = await getJobRunner().cancel(id);
  if (!cancelled) {
    return NextResponse.json({ error: 'Job çalışmıyor veya sırada değil' }, { status: 409 });
  }
  return NextResponse.json({ cancelled: true });
}
