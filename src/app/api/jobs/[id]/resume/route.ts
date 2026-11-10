import { NextRequest, NextResponse } from 'next/server';
import { getJobRunner } from '@/modules/jobs/job-runner';
import { CredentialManager } from '@/modules/config/credential-manager';

/**
 * POST /api/jobs/[id]/resume
 * body: { credentials: { orgId, apiKey } }
 * Yarım kalan (interrupted/failed/cancelled) veya eksikli tamamlanan işi
 * kaldığı yerden sürdürür; tamamlanmış item'lar tekrar işlenmez.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  let body: { credentials?: { orgId?: string; apiKey?: string } };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Geçersiz istek gövdesi' }, { status: 400 });
  }

  const credentials = body.credentials;
  if (!credentials?.orgId || !credentials?.apiKey) {
    return NextResponse.json({ error: 'Unity Cloud Build credentials eksik' }, { status: 401 });
  }
  if (!CredentialManager.validateOrgIdFormat(credentials.orgId) || !CredentialManager.validateApiKeyFormat(credentials.apiKey)) {
    return NextResponse.json({ error: 'Credentials formatı geçersiz' }, { status: 400 });
  }

  try {
    const job = await getJobRunner().resume(id, { orgId: credentials.orgId, apiKey: credentials.apiKey });
    return NextResponse.json({ job }, { status: 202 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Resume başarısız';
    const status = message.includes('bulunamadı') ? 404 : message.includes('zaten') ? 409 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
