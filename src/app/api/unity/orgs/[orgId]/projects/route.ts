import { NextRequest, NextResponse } from 'next/server';

const BASE_URL = 'https://build-api.cloud.unity3d.com/api/v1';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ orgId: string }> }
) {
  try {
    const apiKey = request.headers.get('x-api-key');
    
    if (!apiKey) {
      return NextResponse.json({ error: 'API key required' }, { status: 401 });
    }

    // Next.js 15: params artık async
    const { orgId } = await params;

    // Python scriptindeki AUTH = base64.b64encode(f":{API_KEY}".encode()).decode()
    const auth = Buffer.from(`:${apiKey}`).toString('base64');
    
    const headers = {
      'Authorization': `Basic ${auth}`,
      'Accept': 'application/json',
      'User-Agent': 'unity-cloud-build-multi-project-cleaner/1.0'
    };

    const response = await fetch(`${BASE_URL}/orgs/${orgId}/projects`, {
      method: 'GET',
      headers,
      signal: AbortSignal.timeout(30000)
    });

    if (!response.ok) {
      const errorText = await response.text();
      return NextResponse.json(
        { 
          error: `Unity API Error: ${response.status}`,
          details: errorText.slice(0, 200)
        }, 
        { status: response.status }
      );
    }

    const data = await response.json();
    return NextResponse.json(data);
    
  } catch (error) {
    console.error('Unity projects API error:', error);
    return NextResponse.json(
      { error: 'Internal server error' }, 
      { status: 500 }
    );
  }
}
