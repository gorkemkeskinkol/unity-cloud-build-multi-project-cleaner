import { ContentRangeInfo } from '@/types';

// Artık kendi Next.js API routes'larımızı kullanıyoruz
const BASE_URL = '/api/unity';

export class ApiClient {
  private orgId: string;
  private apiKey: string;
  private headers: HeadersInit;

  constructor(orgId: string, apiKey: string) {
    this.orgId = orgId;
    this.apiKey = apiKey;
    
    // API key'i custom header olarak gönderiyoruz
    this.headers = {
      'x-api-key': apiKey,
      'Accept': 'application/json',
      'Content-Type': 'application/json'
    };
  }

  async get<T>(endpoint: string, params?: Record<string, string | number>): Promise<Response> {
    // Browser environment'ta absolute URL oluştur
    const baseUrl = typeof window !== 'undefined' ? window.location.origin : '';
    const fullUrl = `${baseUrl}${BASE_URL}${endpoint}`;
    const url = new URL(fullUrl);
    
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
      try {
        const errorData = await response.json();
        throw new ApiError({
          status: response.status,
          message: errorData.error || `HTTP ${response.status}`,
          details: errorData.details
        });
      } catch (jsonError) {
        // JSON parse edemediysek text olarak al
        const errorText = await response.text();
        throw new ApiError({
          status: response.status,
          message: `HTTP ${response.status}`,
          details: errorText.slice(0, 200)
        });
      }
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
    
    // Yeni sistem: x-api-key header'ını güncelle
    this.headers = {
      'x-api-key': apiKey,
      'Accept': 'application/json',
      'Content-Type': 'application/json'
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
