/**
 * Cache'in geçerli sayıldığı süre. Hem "Cached Projects" listesi hem de scan
 * sırasındaki cache kontrolü bu değeri kullanır; böylece listede görünen her
 * proje gerçekten cache'den gelir, görünmeyen her proje yeniden taranır.
 */
export const DEFAULT_CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 1 hafta
