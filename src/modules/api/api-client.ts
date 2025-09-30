import { ContentRangeInfo } from '@/types';

const BASE_URL = 'https://build-api.cloud.unity3d.com/api/v1';

export class ApiClient {
  private orgId: string;
  private apiKey: string;
  private headers: HeadersInit;

  constructor(orgId: string, apiKey: string) {
    this.orgId = orgId;
    this.apiKey = apiKey;
    
    // Python scriptindeki AUTH = base64.b64encode(f":{API_KEY}".encode()).decode()
    const auth = btoa(`:${apiKey}`);
    
    this.headers = {
      'Authorization': `Basic ${auth}`,
      'Accept': 'application/json',
      'User-Agent': 'unity-cloud-build-multi-project-cleaner/1.0'
    };
  }

  async get<T>(endpoint: string, params?: Record<string, string | number>): Promise<Response> {
    const url = new URL(`${BASE_URL}${endpoint}`);
    
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        url.searchParams.append(key, value.toString());
      }
    }

    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: this.headers,
      signal: AbortSignal.timeout(30000) // 30s timeout
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new ApiError({
        status: response.status,
        message: `HTTP ${response.status}`,
        details: errorText.slice(0, 200)
      });
    }

    return response;
  }

  /**
   * Python scriptindeki content_range_total fonksiyonunun karşılığı
   */
  getContentRangeTotal(response: Response): number {
    const contentRange = response.headers.get('Content-Range') || response.headers.get('content-range');
    
    if (contentRange && contentRange.includes('/')) {
      try {
        const total = contentRange.split('/').pop();
        return total ? parseInt(total, 10) : 0;
      } catch (error) {
        console.warn('Content-Range parse error:', error);
      }
    }

    return 0;
  }

  /**
   * Content-Range header'ını parse eder
   */
  parseContentRange(response: Response): ContentRangeInfo | null {
    const contentRange = response.headers.get('Content-Range') || response.headers.get('content-range');
    
    if (!contentRange) return null;

    // Format: "items 0-9/100" veya "bytes 0-1023/4096"
    const match = contentRange.match(/(\w+)\s+(\d+)-(\d+)\/(\d+)/);
    if (match) {
      return {
        start: parseInt(match[2], 10),
        end: parseInt(match[3], 10),
        total: parseInt(match[4], 10)
      };
    }

    return null;
  }

  getOrgId(): string {
    return this.orgId;
  }

  updateCredentials(orgId: string, apiKey: string): void {
    this.orgId = orgId;
    this.apiKey = apiKey;
    
    const auth = btoa(`:${apiKey}`);
    this.headers = {
      ...this.headers,
      'Authorization': `Basic ${auth}`
    };
  }
}

// Custom error class for API errors
class ApiError extends Error {
  public status: number;
  public details?: string;

  constructor(error: { status: number; message: string; details?: string }) {
    super(error.message);
    this.name = 'ApiError';
    this.status = error.status;
    this.details = error.details;
  }
}

export { ApiError };
