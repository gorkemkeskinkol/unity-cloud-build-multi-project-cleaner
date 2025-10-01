# Cache Implementation - Teknik Döküman

## Genel Bakış

Unity Cloud Build Multi-Project Cleaner uygulamasına **time-based cache sistemi** eklenmiştir. Bu sistem, taranan projelerin database'e kaydedilmesini ve sonraki taramalarda cache'den hızlı erişim sağlanmasını amaçlar.

## İmplementasyon Detayları

### 1. Database Layer

**Dosya**: `src/modules/database/database-service.ts`

**Cache İşlevleri**:
```typescript
// Cache kontrolü
await db.isProjectCached(projectId, cacheMaxAgeMs) // boolean döner

// Cache'den veri çekme
await db.getProject(projectId)
await db.getLatestScanResult(projectId)

// Cache temizleme
await db.clearProjectCache(projectId) // Tek proje
await db.bulkClearProjectsCache(projectIds) // Çoklu proje
await db.clearAllCache(orgId) // Tüm organizasyon
```

**Cache Mekanizması**:
- `lastScannedAt` field'ı ile proje son tarama zamanı tutulur
- TTL kontrolü: `lastScannedAt >= (now - cacheMaxAgeMs)`
- Default TTL: 1 saat (3600000 ms)

### 2. Scan Orchestrator Güncellemeleri

**Dosya**: `src/modules/scanning/scan-orchestrator.ts`

**Cache-Aware Scanning**:
```typescript
// Her proje için
const isCached = await db.isProjectCached(projectId, cacheMaxAgeMs);

if (isCached) {
  // Cache HIT: Database'den çek
  const cachedProject = await db.getProject(projectId);
  const latestScanResult = await db.getLatestScanResult(projectId);
  
  result.isFromCache = true;
  result.cachedAt = cachedProject.lastScannedAt;
} else {
  // Cache MISS: API'den tara
  const apiResult = await unityService.getTotalBuildsForProject(...);
  
  // Database'e kaydet
  await db.saveProject({ lastScannedAt: new Date() });
  await db.saveScanResult(...);
  await db.saveBuildTarget(...);
  await db.saveBuildCount(...);
  
  result.isFromCache = false;
}
```

**Return Type**:
```typescript
interface ProjectScanResult {
  projectId: string;
  projectName: string;
  totalBuilds: number;
  targetCount: number;
  scannedTargets: number;
  status: 'completed' | 'failed' | 'partial';
  errors: string[];
  isFromCache: boolean; // CACHE INDICATOR
  cachedAt?: Date;
}

interface ScanSummary {
  totalProjects: number;
  completedProjects: number;
  totalBuilds: number;
  totalTargets: number;
  totalErrors: number;
  cachedProjects: number; // Cache'den gelen
  freshProjects: number;  // API'den taranan
}
```

### 3. API Endpoints

**Single Project Cache Clear**:
```
DELETE /api/cache/[projectId]
```

**Bulk Cache Clear**:
```
POST /api/cache/bulk
Body: { projectIds: string[] }
```

### 4. Type Definitions

**Dosya**: `src/types/index.ts`

Yeni type'lar:
- `ProjectScanResult`: Cache bilgisi içeren scan result
- `ScanSummary`: Cache istatistikleri içeren özet
- `ScanOptions.cacheMaxAgeMs`: TTL konfigürasyonu

## Kullanım Örnekleri

### Backend Kullanımı

```typescript
// ScanOrchestrator'da cache-aware scanning
const orchestrator = new ScanOrchestrator();
const result = await orchestrator.startScan({
  cacheMaxAgeMs: 3600000, // 1 saat
  limitProjects: 10
});

console.log(`Cached: ${result.summary.cachedProjects}`);
console.log(`Fresh: ${result.summary.freshProjects}`);

result.results.forEach(project => {
  if (project.isFromCache) {
    console.log(`${project.projectName} - CACHED at ${project.cachedAt}`);
  } else {
    console.log(`${project.projectName} - FRESH SCAN`);
  }
});
```

### Cache Temizleme

```typescript
// Tek proje
const response = await fetch('/api/cache/project-id-123', {
  method: 'DELETE'
});

// Çoklu proje
const response = await fetch('/api/cache/bulk', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    projectIds: ['id1', 'id2', 'id3']
  })
});
```

## Performans İyileştirmeleri

1. **Cache Hit Oranı**: Sık taranan projeler için API call'ları minimize edilir
2. **Bulk Operations**: Çoklu proje temizleme tek transaction'da yapılır
3. **Cascade Delete**: İlişkili veriler otomatik temizlenir
4. **Index Kullanımı**: `lastScannedAt` field'ı indexed

## Güvenlik Notları

- Cache temizleme işlemleri authentication gerektirmez (local app)
- Database dosyası local file system'de saklanır
- Sensitive data (API keys) database'de saklanmaz

## İleriye Dönük Geliştirmeler

### Bekleyen UI İmplementasyonu

1. **Cache Status Badge**: Her proje kartında cache durumu gösterimi
2. **Gear Menu**: Proje bazında actions menüsü
   - "Remove from Cache" seçeneği
3. **Bulk Selection**: Checkbox'lar ile toplu seçim
4. **Bulk Actions Toolbar**: Seçili projeler için toplu işlemler
   - "Remove Selected from Cache"
5. **Cache Statistics**: Dashboard'da cache istatistikleri
   - Total cached projects
   - Cache hit rate
   - Last cache clear date

### Planlanan Özellikler

- [ ] Cache expiration policies (configurable TTL)
- [ ] Manual cache refresh (force re-scan)
- [ ] Cache size management
- [ ] Cache export/import
- [ ] Per-project cache settings

## Dokümantasyon Referansları

- **Business Processes**: `docs/business-processes.md` - Bölüm 7
- **Subsystems**: `docs/subsystems.md` - DMS bölümü
- **Module Maps**: `docs/module-maps.md` - Database modülü
- **Prisma Schema**: `prisma/schema.prisma` - Veri modeli

## Test Senaryoları

### 1. Cache Hit Test
```
1. Projeyi tara (API'den çek)
2. Aynı projeyi tekrar tara
3. Beklenen: İkinci tarama cache'den gelir (isFromCache=true)
```

### 2. Cache Expiry Test
```
1. Projeyi tara
2. 1 saatten fazla bekle
3. Projeyi tekrar tara
4. Beklenen: Cache expired, API'den tekrar çeker
```

### 3. Cache Clear Test
```
1. Projeyi tara (cached)
2. Cache'i temizle (DELETE /api/cache/[id])
3. Projeyi tekrar tara
4. Beklenen: API'den yeni tarama yapar
```

### 4. Bulk Clear Test
```
1. 5 proje tara (hepsi cached)
2. 3'ünün cache'ini bulk clear ile temizle
3. 5 projeyi tekrar tara
4. Beklenen: 2'si cached, 3'ü fresh scan
```

## Known Issues

Şu anda bilinen bir issue bulunmamaktadır. Backend implementasyonu tamamlanmış ve test edilmeye hazırdır.

## UI Implementation

### Completed Features

1. ✅ **Cache'den Proje Listesi API Endpoint**
   - Endpoint: `GET /api/cache/projects`
   - DatabaseService'e `getAllCachedProjects()` metodu eklendi
   - Singleton pattern ile doğru implementasyon

2. ✅ **İki Kolonlu Dashboard Layout**
   - Sol kolon (2/3): Ana dashboard içeriği
   - Sağ kolon (1/3): Real-time log paneli
   - Responsive flex layout kullanımı
   - Log paneli sticky position ile sabit

3. ✅ **Cache'deki Projelerin Dashboard'da Listelenmesi**
   - Sayfa yüklendiğinde cache'deki projeler otomatik listelenir
   - Proje adı, platform bilgisi, build sayısı, son tarama zamanı ve cache durumu gösterilir
   - Scan sonrası otomatik cache reload
   - "CACHED" badge ile görsel gösterim

4. ✅ **Project Limit Default Değeri**
   - Default değer `undefined` (boş) olarak ayarlandı
   - Kullanıcı isterse limit girebilir
   - Boş bırakılırsa tüm projeler taranır

5. ✅ **Multi-Select Checkbox Sistemi**
   - Her proje satırında checkbox
   - Header'da "Select All" checkbox (indeterminate state destekli)
   - Checkbox state yönetimi Set<string> ile
   - Seçili proje sayısı dinamik gösterim

6. ✅ **Gear Icon ve Dropdown Menu**
   - Her proje satırında ⚙️ gear ikonu
   - Tıklandığında açılan dropdown menu
   - "Clear Cache" action'ı
   - Dropdown dışına tıklandığında otomatik kapanma
   - Hover effect ile kullanıcı dostu arayüz

7. ✅ **Bulk Actions Toolbar**
   - Proje seçildiğinde "Clear Selected (N)" butonu görünür
   - Bulk cache temizleme fonksiyonu
   - API: `POST /api/cache/bulk` endpoint'i kullanımı
   - İşlem sonrası otomatik cache yenileme

8. ✅ **Cache Temizleme İşlemleri**
   - Tek proje cache temizleme (gear menu'den)
   - Çoklu proje cache temizleme (bulk action)
   - Real-time log entegrasyonu (başarı/hata mesajları)
   - Loading state yönetimi (isClearingCache)
   - İşlem sonrası proje listesi güncelleme

9. ✅ **Shift+Click Range Selection**
   - Normal tıklama: Tek proje seçimi/seçim kaldırma
   - Shift+Click: Son seçimden yeni seçime kadar range toggle
   - Mantık: İlk tıklama index'i saklanır, Shift+Click ile aradaki projeler toggle edilir
   - Örnek: Proje 3 seçili → Shift+Proje 7 = Proje 4,5,6,7 toggle
   - lastClickedIndex state ile takip

### UI Layout Detayları

```tsx
Dashboard Layout:
┌─────────────────────────────────────┬──────────────────┐
│ Header (Title + Reset Button)       │                  │
├─────────────────────────────────────┤                  │
│ Left Column (flex: 2)                │ Right Column     │
│                                      │ (flex: 1)        │
│ - Configuration Info                 │                  │
│ - Scan Controls                      │ Log Panel        │
│ - Cached Projects Table              │ (sticky)         │
│ - Scan Results                       │                  │
│                                      │                  │
└─────────────────────────────────────┴──────────────────┘
```

### Cached Projects Table Görünümü

Tablo kolonları:
1. **Project Name**: Proje adı
2. **Last Scanned**: Son tarama tarihi (tr-TR locale)
3. **Status**: "CACHED" badge (yeşil renk)

Özellikler:
- Sayfa yüklendiğinde otomatik yükleme
- Loading state gösterimi
- Boş cache durumu için bilgilendirme mesajı
- Scan sonrası otomatik güncelleme

## Yapılacaklar (Next Steps)

1. ✅ Database Service Layer - TAMAMLANDI
2. ✅ Cache Logic Implementation - TAMAMLANDI  
3. ✅ ScanOrchestrator Integration - TAMAMLANDI
4. ✅ API Endpoints - TAMAMLANDI
5. ✅ Type Definitions - TAMAMLANDI
6. ✅ Documentation - TAMAMLANDI
7. ✅ UI Implementation - TAMAMLANDI
   - ✅ Cache status indicators
   - ✅ Two-column layout (2/3 dashboard, 1/3 logs)
   - ✅ Cached projects list on page load
   - ✅ Project limit default value (empty)
   - ✅ Gear menu with actions (clear cache)
   - ✅ Bulk selection checkboxes (multi-select)
   - ✅ Bulk actions toolbar (clear selected)
8. ⏳ Testing - BEKLIYOR
   - Unit tests
   - Integration tests
   - E2E tests
