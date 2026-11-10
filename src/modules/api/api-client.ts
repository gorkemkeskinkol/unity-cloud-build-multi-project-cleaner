import { ContentRangeInfo } from '@/types';

// Client-side için Next.js API routes
const NEXTJS_API_BASE = '/api/unity';
// Server-side için direkt Unity API
const UNITY_API_BASE = 'https://build-api.cloud.unity3d.com/api/v1';

/** İstekler arası minimum bekleme (ms). Unity abuse detection'ı tetiklememek için. */
const DEFAULT_MIN_INTERVAL_MS = Number(process.env.UNITY_API_MIN_INTERVAL_MS) || 400;
/** Tek istek için zaman aşımı */
const REQUEST_TIMEOUT_MS = 30_000;

/**
 * Rate limit (abuse detection) bekleme planı. Unity bloğu dakikalar sürüyor ve
 * blok sürerken atılan her istek pencereyi uzatıyor gibi davranıyor; bu yüzden
 * seyrek yoklarız: 1 → 2 → 5 → 10 → 15 dk. Retry-After header'ı varsa o öncelikli.
 */
const RATE_LIMIT_WAIT_SCHEDULE_MS = [60_000, 120_000, 300_000, 600_000, 900_000];
const RATE_LIMIT_MAX_ATTEMPTS = 10;

/** Geçici sunucu / ağ hataları için bekleme planı */
const TRANSIENT_WAIT_SCHEDULE_MS = [3_000, 6_000, 12_000, 24_000];
const TRANSIENT_MAX_ATTEMPTS = TRANSIENT_WAIT_SCHEDULE_MS.length + 1;

/** Rate limit olmayan düz 403 için (yetki hatası olabilir) kısa deneme */
const FORBIDDEN_MAX_ATTEMPTS = 2;
const FORBIDDEN_WAIT_MS = 5_000;

export type ApiErrorKind =
  | 'rate_limit'   // 429 veya abuse detection 403'ü
  | 'auth'         // 401
  | 'forbidden'    // abuse detection olmayan 403
  | 'not_found'    // 404
  | 'client'       // diğer 4xx
  | 'server'       // 5xx
  | 'network'      // fetch hatası / timeout
  | 'cancelled';   // kullanıcı iptali

export interface WaitInfo {
  reason: ApiErrorKind;
  status: number;
  endpoint: string;
  waitMs: number;
  attempt: number;
  maxAttempts: number;
}

export interface ApiClientOptions {
  /** İki istek arasında en az bu kadar beklenir */
  minIntervalMs?: number;
  /** Bir bekleme başlamadan hemen önce çağrılır (loglama için) */
  onWait?: (info: WaitInfo) => void;
  /** true dönerse bekleme kesilir ve CancelledError fırlatılır */
  shouldCancel?: () => boolean;
}

export class ApiClient {
  private orgId: string;
  private apiKey: string;
  private headers: HeadersInit;
  private isServerSide: boolean;
  private minIntervalMs: number;
  private onWait?: (info: WaitInfo) => void;
  private shouldCancel: () => boolean;

  /**
   * Throttle ve blok durumu TÜM instance'lar arasında paylaşılır: aynı anda süren
   * bir scan ve bir artifact silme işlemi Unity'yi ayrı ayrı yoklamasın.
   */
  private static lastRequestAt = 0;
  private static blockedUntil = 0;

  constructor(orgId: string, apiKey: string, options: ApiClientOptions = {}) {
    this.orgId = orgId;
    this.apiKey = apiKey;
    this.isServerSide = typeof window === 'undefined';
    this.minIntervalMs = options.minIntervalMs ?? DEFAULT_MIN_INTERVAL_MS;
    this.onWait = options.onWait;
    this.shouldCancel = options.shouldCancel ?? (() => false);
    this.headers = this.buildHeaders(apiKey);
  }

  setWaitCallback(callback?: (info: WaitInfo) => void): void {
    this.onWait = callback;
  }

  setCancelCheck(check?: () => boolean): void {
    this.shouldCancel = check ?? (() => false);
  }

  /** Şu an rate limit bloğu sürüyorsa kalan süre (ms), yoksa 0 */
  static remainingBlockMs(): number {
    return Math.max(0, ApiClient.blockedUntil - Date.now());
  }

  async get(endpoint: string, params?: Record<string, string | number>): Promise<Response> {
    return this.request('GET', endpoint, params);
  }

  async delete(endpoint: string): Promise<Response> {
    return this.request('DELETE', endpoint);
  }

  /**
   * Tek giriş noktası: throttle + sınıflandırılmış retry.
   * - rate_limit  → uzun bekleme (Retry-After veya 30s→5dk), 12 denemeye kadar
   * - server/network → 3s→24s, 5 denemeye kadar
   * - forbidden   → 5s, 2 deneme (gerçek yetki hatası olabilir)
   * - auth/not_found/client → hemen fırlatılır
   */
  private async request(
    method: 'GET' | 'DELETE',
    endpoint: string,
    params?: Record<string, string | number>
  ): Promise<Response> {
    const url = this.buildUrl(endpoint, params);
    let rateLimitAttempt = 0;
    let transientAttempt = 0;
    let forbiddenAttempt = 0;

    // Sonsuz döngü değil: her dal kendi limitine ulaşınca throw eder
    for (;;) {
      await this.waitForTurn();

      let response: Response;
      try {
        ApiClient.lastRequestAt = Date.now();
        response = await fetch(url.toString(), {
          method,
          headers: this.headers,
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
        });
      } catch (error) {
        // Ağ hatası veya timeout
        transientAttempt++;
        const apiError = new ApiError({
          status: 0,
          kind: 'network',
          message: `Ağ hatası: ${error instanceof Error ? error.message : String(error)}`,
          endpoint
        });
        if (transientAttempt >= TRANSIENT_MAX_ATTEMPTS) throw apiError;
        await this.backoff('network', 0, endpoint, TRANSIENT_WAIT_SCHEDULE_MS[transientAttempt - 1], transientAttempt, TRANSIENT_MAX_ATTEMPTS);
        continue;
      }

      if (response.ok) {
        return response;
      }

      const errorText = await response.text();
      const kind = classifyError(response.status, errorText);
      const apiError = new ApiError({
        status: response.status,
        kind,
        message: extractMessage(errorText) || `HTTP ${response.status}`,
        details: errorText.slice(0, 300),
        endpoint
      });

      switch (kind) {
        case 'rate_limit': {
          rateLimitAttempt++;
          if (rateLimitAttempt >= RATE_LIMIT_MAX_ATTEMPTS) throw apiError;
          const retryAfterMs = parseRetryAfter(response.headers.get('Retry-After'));
          const scheduled = RATE_LIMIT_WAIT_SCHEDULE_MS[Math.min(rateLimitAttempt - 1, RATE_LIMIT_WAIT_SCHEDULE_MS.length - 1)];
          const waitMs = retryAfterMs ?? scheduled;
          // Diğer tüm istekler (başka instance'lar dahil) bu süre boyunca beklesin
          ApiClient.blockedUntil = Date.now() + waitMs;
          await this.backoff('rate_limit', response.status, endpoint, waitMs, rateLimitAttempt, RATE_LIMIT_MAX_ATTEMPTS);
          continue;
        }
        case 'server': {
          transientAttempt++;
          if (transientAttempt >= TRANSIENT_MAX_ATTEMPTS) throw apiError;
          await this.backoff('server', response.status, endpoint, TRANSIENT_WAIT_SCHEDULE_MS[transientAttempt - 1], transientAttempt, TRANSIENT_MAX_ATTEMPTS);
          continue;
        }
        case 'forbidden': {
          forbiddenAttempt++;
          if (forbiddenAttempt >= FORBIDDEN_MAX_ATTEMPTS) throw apiError;
          await this.backoff('forbidden', response.status, endpoint, FORBIDDEN_WAIT_MS, forbiddenAttempt, FORBIDDEN_MAX_ATTEMPTS);
          continue;
        }
        default:
          // auth, not_found, client: tekrar denemenin anlamı yok
          throw apiError;
      }
    }
  }

  /** Throttle ve global rate limit bloğunu bekler */
  private async waitForTurn(): Promise<void> {
    // Döngü: bekleme sırasında başka bir instance bloğu uzatmış olabilir
    for (;;) {
      const now = Date.now();
      const untilBlockEnds = ApiClient.blockedUntil - now;
      const untilInterval = ApiClient.lastRequestAt + this.minIntervalMs - now;
      const waitMs = Math.max(untilBlockEnds, untilInterval, 0);
      if (waitMs <= 0) return;
      await this.sleep(waitMs);
    }
  }

  private async backoff(
    reason: ApiErrorKind,
    status: number,
    endpoint: string,
    waitMs: number,
    attempt: number,
    maxAttempts: number
  ): Promise<void> {
    this.onWait?.({ reason, status, endpoint, waitMs, attempt, maxAttempts });
    console.warn(`[API RETRY] ${reason} (HTTP ${status}) ${endpoint} → ${Math.round(waitMs / 1000)}s bekleniyor (${attempt}/${maxAttempts})`);
    await this.sleep(waitMs);
  }

  /** İptal kontrolü yapan uyku: uzun beklemelerde kullanıcı iptali anında işler */
  private async sleep(ms: number): Promise<void> {
    const deadline = Date.now() + ms;
    while (true) {
      if (this.shouldCancel()) {
        throw new CancelledError();
      }
      const remaining = deadline - Date.now();
      if (remaining <= 0) return;
      await new Promise(resolve => setTimeout(resolve, Math.min(remaining, 1000)));
    }
  }

  private buildUrl(endpoint: string, params?: Record<string, string | number>): URL {
    const url = this.isServerSide
      ? new URL(`${UNITY_API_BASE}${endpoint}`)
      : new URL(`${window.location.origin}${NEXTJS_API_BASE}${endpoint}`);

    if (params) {
      for (const [key, value] of Object.entries(params)) {
        url.searchParams.append(key, value.toString());
      }
    }
    return url;
  }

  private buildHeaders(apiKey: string): HeadersInit {
    if (this.isServerSide) {
      // Server-side: Unity API'ye Basic auth
      const auth = Buffer.from(`:${apiKey}`).toString('base64');
      return {
        'Authorization': `Basic ${auth}`,
        'Accept': 'application/json',
        'User-Agent': 'unity-cloud-build-multi-project-cleaner/1.0'
      };
    }
    // Client-side: Next.js proxy route'larına x-api-key
    return {
      'x-api-key': apiKey,
      'Accept': 'application/json',
      'Content-Type': 'application/json'
    };
  }

  /**
   * Python scriptindeki content_range_total fonksiyonunun karşılığı
   */
  getContentRangeTotal(response: Response): number {
    const info = this.parseContentRange(response);
    return info ? info.total : 0;
  }

  /**
   * Content-Range header'ını parse eder. Format: "items 0-9/100"
   */
  parseContentRange(response: Response): ContentRangeInfo | null {
    const contentRange = response.headers.get('Content-Range') || response.headers.get('content-range');
    if (!contentRange) return null;

    const match = contentRange.match(/(\w+)\s+(\d+)-(\d+)\/(\d+)/);
    if (match) {
      return {
        start: parseInt(match[2], 10),
        end: parseInt(match[3], 10),
        total: parseInt(match[4], 10)
      };
    }

    // "items */0" gibi boş aralık
    const emptyMatch = contentRange.match(/\*\/(\d+)/);
    if (emptyMatch) {
      return { start: 0, end: 0, total: parseInt(emptyMatch[1], 10) };
    }

    return null;
  }

  getOrgId(): string {
    return this.orgId;
  }

  updateCredentials(orgId: string, apiKey: string): void {
    this.orgId = orgId;
    this.apiKey = apiKey;
    this.headers = this.buildHeaders(apiKey);
  }
}

function classifyError(status: number, body: string): ApiErrorKind {
  if (status === 429) return 'rate_limit';
  if (status === 403) {
    // Unity abuse detection mesajı: "You have triggered an abuse detection mechanism, and have been temporarily blocked."
    return /abuse|temporarily blocked|rate limit|too many requests/i.test(body) ? 'rate_limit' : 'forbidden';
  }
  if (status === 401) return 'auth';
  if (status === 404) return 'not_found';
  if (status >= 500) return 'server';
  return 'client';
}

function extractMessage(body: string): string | null {
  try {
    const parsed = JSON.parse(body);
    if (parsed && typeof parsed.error === 'string') return parsed.error;
    if (parsed && typeof parsed.message === 'string') return parsed.message;
  } catch {
    // JSON değil
  }
  return null;
}

/** Retry-After: saniye sayısı veya HTTP tarihi */
function parseRetryAfter(header: string | null): number | null {
  if (!header) return null;
  const seconds = Number(header);
  if (!Number.isNaN(seconds) && seconds > 0) return seconds * 1000;
  const date = Date.parse(header);
  if (!Number.isNaN(date)) {
    const ms = date - Date.now();
    return ms > 0 ? ms : null;
  }
  return null;
}

/** Bekleme bilgisini kullanıcıya gösterilecek Türkçe mesaja çevirir (scan ve delete akışları ortak kullanır) */
export function describeWait(info: WaitInfo): string {
  const seconds = Math.round(info.waitMs / 1000);
  const attempt = `(deneme ${info.attempt}/${info.maxAttempts})`;
  switch (info.reason) {
    case 'rate_limit':
      return `Unity API geçici olarak engelledi (HTTP ${info.status}, abuse detection). ${seconds} sn bekleniyor, sonra kaldığı yerden devam edecek ${attempt}`;
    case 'server':
      return `Unity API sunucu hatası (HTTP ${info.status}). ${seconds} sn sonra tekrar denenecek ${attempt}`;
    case 'network':
      return `Ağ hatası / zaman aşımı. ${seconds} sn sonra tekrar denenecek ${attempt}`;
    default:
      return `HTTP ${info.status} alındı. ${seconds} sn sonra tekrar denenecek ${attempt}`;
  }
}

export class ApiError extends Error {
  public status: number;
  public kind: ApiErrorKind;
  public details?: string;
  public endpoint?: string;

  constructor(error: { status: number; kind: ApiErrorKind; message: string; details?: string; endpoint?: string }) {
    super(error.message);
    this.name = 'ApiError';
    this.status = error.status;
    this.kind = error.kind;
    this.details = error.details;
    this.endpoint = error.endpoint;
  }

  /** Kullanıcıya gösterilecek kısa açıklama */
  describe(): string {
    switch (this.kind) {
      case 'rate_limit':
        return `Unity API rate limit (HTTP ${this.status}) - tüm beklemeler tükendi`;
      case 'auth':
        return 'API key geçersiz (HTTP 401)';
      case 'forbidden':
        return `Erişim reddedildi (HTTP 403): ${this.message}`;
      case 'not_found':
        return `Bulunamadı (HTTP 404)`;
      case 'network':
        return this.message;
      default:
        return `HTTP ${this.status}: ${this.message}`;
    }
  }
}

export class CancelledError extends Error {
  constructor() {
    super('İşlem kullanıcı tarafından iptal edildi');
    this.name = 'CancelledError';
  }
}
