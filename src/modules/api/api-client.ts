import { ContentRangeInfo } from '@/types';

// Client-side için Next.js API routes
const NEXTJS_API_BASE = '/api/unity';
// Server-side için direkt Unity API
const UNITY_API_BASE = 'https://build-api.cloud.unity3d.com/api/v1';

export class ApiClient {
  private orgId: string;
  private apiKey: string;
  private headers: HeadersInit;
  private isServerSide: boolean;

  constructor(orgId: string, apiKey: string) {
    this.orgId = orgId;
    this.apiKey = apiKey;
    this.isServerSide = typeof window === 'undefined';
    
    // Server-side: Basic auth for Unity API
    // Client-side: x-api-key header for Next.js routes
    if (this.isServerSide) {
      const auth = Buffer.from(`:${apiKey}`).toString('base64');
      this.headers = {
        'Authorization': `Basic ${auth}`,
        'Accept': 'application/json',
        'User-Agent': 'unity-cloud-build-multi-project-cleaner/1.0'
      };
    } else {
      this.headers = {
        'x-api-key': apiKey,
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      };
    }
  }

  async delete(endpoint: string): Promise<Response> {
    const maxRetries = 3;
    let lastError: ApiError | null = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        let url: URL;
        
        if (this.isServerSide) {
          // Server-side: Direkt Unity API'ye git
          url = new URL(`${UNITY_API_BASE}${endpoint}`);
        } else {
          // Client-side: Next.js API routes kullan
          const fullUrl = `${window.location.origin}${NEXTJS_API_BASE}${endpoint}`;
          url = new URL(fullUrl);
        }

        const response = await fetch(url.toString(), {
          method: 'DELETE',
          headers: this.headers,
          signal: AbortSignal.timeout(30000) // 30s timeout
        });

        if (!response.ok) {
          const errorText = await response.text();
          
          try {
            const errorData = JSON.parse(errorText);
            const apiError = new ApiError({
              status: response.status,
              message: errorData.error || `HTTP ${response.status}`,
              details: errorData.details
            });
            
            if (response.status === 403 && attempt < maxRetries) {
              const waitTime = Math.pow(2, attempt) * 1000;
              console.warn(`[API DELETE RETRY] 403 alındı, ${waitTime}ms bekleyip tekrar denenecek (${attempt}/${maxRetries})`);
              await new Promise(resolve => setTimeout(resolve, waitTime));
              lastError = apiError;
              continue;
            }
            
            throw apiError;
          } catch (jsonError) {
            const apiError = new ApiError({
              status: response.status,
              message: `HTTP ${response.status}`,
              details: errorText.slice(0, 200)
            });
            
            if (response.status === 403 && attempt < maxRetries) {
              const waitTime = Math.pow(2, attempt) * 1000;
              console.warn(`[API DELETE RETRY] 403 alındı, ${waitTime}ms bekleyip tekrar denenecek (${attempt}/${maxRetries})`);
              await new Promise(resolve => setTimeout(resolve, waitTime));
              lastError = apiError;
              continue;
            }
            
            throw apiError;
          }
        }

        return response;
      } catch (error) {
        if (error instanceof ApiError) {
          if (error.status === 403 && attempt < maxRetries) {
            lastError = error;
            continue;
          }
          throw error;
        }
        throw error;
      }
    }

    throw lastError || new ApiError({
      status: 500,
      message: 'Maksimum deneme sayısına ulaşıldı',
      details: 'API rate limit nedeniyle tüm denemeler başarısız oldu'
    });
  }

  async get<T>(endpoint: string, params?: Record<string, string | number>): Promise<Response> {
    const maxRetries = 3;
    let lastError: ApiError | null = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        let url: URL;
        
        if (this.isServerSide) {
          // Server-side: Direkt Unity API'ye git
          url = new URL(`${UNITY_API_BASE}${endpoint}`);
        } else {
          // Client-side: Next.js API routes kullan
          const fullUrl = `${window.location.origin}${NEXTJS_API_BASE}${endpoint}`;
          url = new URL(fullUrl);
        }
        
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
          // Body'yi bir kez text olarak oku
          const errorText = await response.text();
          
          // JSON parse etmeyi dene
          try {
            const errorData = JSON.parse(errorText);
            const apiError = new ApiError({
              status: response.status,
              message: errorData.error || `HTTP ${response.status}`,
              details: errorData.details
            });
            
            // 403 (rate limit) ise ve henüz deneme hakkımız varsa, bekle ve tekrar dene
            if (response.status === 403 && attempt < maxRetries) {
              const waitTime = Math.pow(2, attempt) * 1000; // 2s, 4s, 8s
              console.warn(`[API RETRY] 403 alındı, ${waitTime}ms bekleyip tekrar denenecek (${attempt}/${maxRetries})`);
              await new Promise(resolve => setTimeout(resolve, waitTime));
              lastError = apiError;
              continue; // Bir sonraki denemeye geç
            }
            
            throw apiError;
          } catch (jsonError) {
            // JSON değilse text olarak kullan
            const apiError = new ApiError({
              status: response.status,
              message: `HTTP ${response.status}`,
              details: errorText.slice(0, 200)
            });
            
            // 403 (rate limit) ise ve henüz deneme hakkımız varsa, bekle ve tekrar dene
            if (response.status === 403 && attempt < maxRetries) {
              const waitTime = Math.pow(2, attempt) * 1000; // 2s, 4s, 8s
              console.warn(`[API RETRY] 403 alındı, ${waitTime}ms bekleyip tekrar denenecek (${attempt}/${maxRetries})`);
              await new Promise(resolve => setTimeout(resolve, waitTime));
              lastError = apiError;
              continue; // Bir sonraki denemeye geç
            }
            
            throw apiError;
          }
        }

        return response;
      } catch (error) {
        // Eğer ApiError ise ve 403 ise, retry logic zaten çalıştı
        if (error instanceof ApiError) {
          if (error.status === 403 && attempt < maxRetries) {
            lastError = error;
            continue;
          }
          throw error;
        }
        // Diğer hatalar için direkt throw et
        throw error;
      }
    }

    // Tüm denemeler başarısız oldu
    throw lastError || new ApiError({
      status: 500,
      message: 'Maksimum deneme sayısına ulaşıldı',
      details: 'API rate limit nedeniyle tüm denemeler başarısız oldu'
    });
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
    
    // Header'ları environment'a göre güncelle
    if (this.isServerSide) {
      const auth = Buffer.from(`:${apiKey}`).toString('base64');
      this.headers = {
        'Authorization': `Basic ${auth}`,
        'Accept': 'application/json',
        'User-Agent': 'unity-cloud-build-multi-project-cleaner/1.0'
      };
    } else {
      this.headers = {
        'x-api-key': apiKey,
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      };
    }
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
