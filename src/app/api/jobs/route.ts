import { NextRequest, NextResponse } from 'next/server';
import { getJobRunner } from '@/modules/jobs/job-runner';
import { JobStore } from '@/modules/jobs/job-store';
import { CredentialManager } from '@/modules/config/credential-manager';
import { JobType, JobParams } from '@/types/jobs';

/**
 * GET /api/jobs → son 50 job (en yeni önce)
 */
export async function GET() {
  try {
    const runner = getJobRunner();
    await runner.boot();
    const jobs = await new JobStore().listJobs(50);
    return NextResponse.json({ jobs, runningJobId: runner.getRunningJobId() });
  } catch (error) {
    console.error('[JOBS] list error:', error);
    return NextResponse.json({ error: 'Job listesi alınamadı' }, { status: 500 });
  }
}

/**
 * POST /api/jobs
 * body: { type: 'full_scan' | 'delete_builds', params: JobParams, credentials: { orgId, apiKey } }
 * Credentials veritabanına yazılmaz; sadece runner belleğinde tutulur.
 */
export async function POST(request: NextRequest) {
  let body: { type?: JobType; params?: Partial<JobParams>; credentials?: { orgId?: string; apiKey?: string } };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Geçersiz istek gövdesi' }, { status: 400 });
  }

  const { type, params, credentials } = body;
  if (type !== 'full_scan' && type !== 'delete_builds') {
    return NextResponse.json({ error: 'type full_scan veya delete_builds olmalı' }, { status: 400 });
  }
  if (!credentials?.orgId || !credentials?.apiKey) {
    return NextResponse.json({ error: 'Unity Cloud Build credentials eksik' }, { status: 401 });
  }
  if (!CredentialManager.validateOrgIdFormat(credentials.orgId) || !CredentialManager.validateApiKeyFormat(credentials.apiKey)) {
    return NextResponse.json({ error: 'Credentials formatı geçersiz' }, { status: 400 });
  }
  if (type === 'delete_builds' && !params?.projectId) {
    return NextResponse.json({ error: 'delete_builds için params.projectId gerekli' }, { status: 400 });
  }

  const jobParams: JobParams = {
    orgId: credentials.orgId,
    limitProjects: params?.limitProjects || undefined,
    limitTargets: params?.limitTargets || undefined,
    projectId: params?.projectId,
    projectName: params?.projectName,
    updateCache: params?.updateCache
  };

  try {
    const job = await getJobRunner().enqueue(type, jobParams, { orgId: credentials.orgId, apiKey: credentials.apiKey });
    return NextResponse.json({ job }, { status: 202 });
  } catch (error) {
    console.error('[JOBS] enqueue error:', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Job oluşturulamadı' }, { status: 500 });
  }
}
