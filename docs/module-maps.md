# Modül Haritaları

## Database Modülü (`src/modules/database/`)

### database-service.ts
**Sorumluluk**: SQLite database işlemleri için singleton service layer

**Ana Fonksiyonlar:**
- `getInstance()`: DatabaseService singleton instance
- `upsertOrganization()`: Organization kaydet/güncelle
- `saveProject()`: Project bilgilerini kaydet
- `getProject()`: Project bilgilerini çek
- `getCachedProjects()`: Cache'lenmiş projeleri listele
- `isProjectCached()`: Projenin cache durumunu kontrol et
- `saveBuildTarget()`: Build target bilgilerini kaydet
- `getBuildTargetsForProject()`: Proje build target'larını çek
- `saveScanResult()`: Scan sonucunu kaydet
- `getLatestScanResult()`: En son scan sonucunu çek
- `saveBuildCount()`: Build count kaydet
- `clearProjectCache()`: Tek proje cache'ini temizle
- `bulkClearProjectsCache()`: Çoklu proje cache temizleme
- `clearAllCache()`: Organizasyondaki tüm cache'i temizle
- `saveLog()`: Log entry kaydet
- `getLogs()`: Log listesi çek
- `getProjectStats()`: Proje istatistikleri

**İlişkiler:**
- Prisma Client kullanır
- ScanOrchestrator tarafından kullanılır
- Cache API endpoints tarafından kullanılır

**Cache Logic:**
- Time-based TTL kontrolü (lastScannedAt field'ı ile)
- Default cache süresi: 1 saat (3600000 ms)
- Cascade delete operasyonları
- Transaction support

---

## Configuration Management System (CMS) Modülleri

### 1. CredentialManager
**Dosya**: `src/modules/config/credential-manager.ts`
**Sorumluluk**: API credentials yönetimi
```typescript
interface CredentialManager {
  validateApiKey(key: string): Promise<boolean>
  storeCredentials(orgId: string, apiKey: string): void
  getCredentials(): { orgId: string, apiKey: string } | null
  clearCredentials(): void
}
```

### 2. SettingsValidator 
**Dosya**: `src/modules/config/settings-validator.ts`
**Sorumluluk**: Kullanıcı ayarlarının doğrulanması
**Bağımlılık**: CredentialManager

### 3. SetupWizard Component
**Dosya**: `src/components/setup/SetupWizard.tsx`
**Sorumluluk**: İlk kurulum UI
**Bağımlılık**: CredentialManager, SettingsValidator

---

## Unity Cloud Build API Integration (UCBAI) Modülleri

### 1. ApiClient ✅
**Dosya**: `src/modules/api/api-client.ts`
**Sorumluluk**: Temel HTTP operations (Dual-mode: Client & Server)
```typescript
interface ApiClient {
  get(endpoint: string, params?: object): Promise<Response>
  delete(endpoint: string): Promise<Response>
  getContentRangeTotal(response: Response): number
  setWaitCallback(cb?: (info: WaitInfo) => void): void   // bekleme bildirimi (loglama)
  setCancelCheck(check?: () => boolean): void            // bekleme sırasında iptal
}
class ApiError { status; kind: 'rate_limit'|'auth'|'forbidden'|'not_found'|'client'|'server'|'network'; describe() }
class CancelledError
```
**Özellikler**:
- **Client-side**: Next.js API routes üzerinden proxy (`/api/unity/...`)
- **Server-side**: Direkt Unity API'ye bağlanır (`https://build-api.cloud.unity3d.com/...`)
- Otomatik environment detection (`typeof window === 'undefined'`)
- Client: `x-api-key` header | Server: `Basic` auth
- 30 saniye timeout
- Tek `request()` giriş noktası: throttle (istekler arası min. 400 ms, `UNITY_API_MIN_INTERVAL_MS`) + sınıflandırılmış retry
- Rate limit (429 / abuse detection 403): Retry-After veya 1→15 dk arası bekleme, 10 denemeye kadar; blok durumu static, tüm instance'lar bekler
- 5xx / ağ hatası: 3s→24s, 5 deneme. 401/404: tekrar denenmez
- Beklemeler iptal edilebilir (`CancelledError`)

**Durum**: ✅ Tamamlandı - Hem client hem server-side çalışır, CORS sorunu yok

### 2. UnityCloudBuildService ✅
**Dosya**: `src/modules/api/unity-cloud-build.ts`
**Sorumluluk**: Unity specific API operations
**Bağımlılık**: ApiClient
```typescript
interface UnityCloudBuildService {
  listProjects(orgId: string): Promise<Project[]>
  listBuildTargets(orgId: string, projectId: string): Promise<BuildTarget[]>
  countBuilds(orgId: string, projectId: string, buildTargetId: string): Promise<number>
  sanityCheckOrg(orgId: string): Promise<number>
  scanProject(projectId: string, limitTargets?: number): Promise<ProjectScanData>  // targets + sayımlar tek seferde
  setWaitCallback(cb): void
  setCancelCheck(check): void
  deleteArtifactsForTarget(projectId: string, buildTargetId: string): Promise<void>
  deleteAllBuildsForProject(projectId: string, onProgress?: Function): Promise<DeletionResult>
}
```
**Durum**: ✅ Tamamlandı - Tam proje scanning + artifact deletion desteği

### 3. Next.js API Routes ✅
**CORS Çözümü için Server-Side Proxy**
- `src/app/api/unity/orgs/[orgId]/builds/route.ts` - Organization builds
- `src/app/api/unity/orgs/[orgId]/projects/route.ts` - Project listing
- `src/app/api/unity/orgs/[orgId]/projects/[projectId]/buildtargets/route.ts` - Build targets
- `src/app/api/unity/orgs/[orgId]/projects/[projectId]/buildtargets/[targetId]/builds/route.ts` - Specific builds
- `src/app/api/unity/orgs/[orgId]/projects/[projectId]/delete-builds/route.ts` - Delete build artifacts (SSE)

**Durum**: ✅ Tamamlandı - CORS sorunu çözüldü, tüm Unity API endpoint'leri proxy edildi

**Next.js 15 Breaking Change - Async Params:**
Next.js 15'te dinamik route parametreleri (`params`) artık asenkron hale geldi. Tüm route handler'larda:
```typescript
// ❌ Eski (Next.js 14)
export async function DELETE(
  request: NextRequest,
  { params }: { params: { projectId: string } }
) {
  const { projectId } = params;
}

// ✅ Yeni (Next.js 15)
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const { projectId } = await params;
}
```
**Etkilenen Dosyalar:**
- `src/app/api/cache/[projectId]/route.ts` ✅ Güncellendi
- `src/app/api/unity/orgs/[orgId]/projects/[projectId]/delete-builds/route.ts` ✅ Güncellendi
- Diğer dinamik route'lar zaten günceldi

---

## Database Management System (DMS) Modülleri

### 1. PrismaClient
**Dosya**: `prisma/schema.prisma`
**Sorumluluk**: Database schema tanımı

### 2. DatabaseService
**Dosya**: `src/modules/database/database-service.ts`
**Sorumluluk**: CRUD operations
```typescript
interface DatabaseService {
  saveProject(project: ProjectData): Promise<void>
  saveBuildTarget(target: BuildTargetData): Promise<void>
  saveScanResult(result: ScanResult): Promise<void>
  getProjectHistory(): Promise<ProjectData[]>
}
```

### 3. Migration Manager
**Dosya**: `src/modules/database/migration-manager.ts`
**Sorumluluk**: Schema versioning

---

## Real-time Logging System (RLS) Modülleri

### 1. LogContext
**Dosya**: `src/contexts/LogContext.tsx`
**Sorumluluk**: Global log state
```typescript
interface LogContextType {
  logs: LogEntry[]
  addLog(level: LogLevel, message: string): void
  clearLogs(): void
}
```

### 2. LogPanel Component
**Dosya**: `src/components/logs/LogPanel.tsx`
**Sorumluluk**: Log görüntüleme UI
**Bağımlılık**: LogContext

### 3. NotificationService
**Dosya**: `src/modules/notifications/notification-service.ts`
**Sorumluluk**: Mantine notifications wrapper
**Bağımlılık**: LogContext

---

## User Interface System (UIS) Modülleri

### 1. Layout Components
**Dosya**: `src/components/layout/`
- `AppShell.tsx`: Ana layout wrapper
- `Navigation.tsx`: Sidebar navigation
- `Header.tsx`: Top header

### 2. Dashboard Components
**Dosya**: `src/components/dashboard/`
- `ProjectGrid.tsx`: Proje listesi
- `ProjectCard.tsx`: Tek proje kartı
- `StatsOverview.tsx`: Özet istatistikler

### 3. Form Components
**Dosya**: `src/components/forms/`
- `ConfigForm.tsx`: Ayar formu
- `ProjectFilters.tsx`: Filtreleme formu

---

## Data Collection & Processing System (DCPS) Modülleri

### 1. ScanOrchestrator ✅
**Dosya**: `src/modules/scanning/scan-orchestrator.ts`
**Sorumluluk**: Scanning işlem koordinasyonu
```typescript
interface ScanOrchestrator {
  startScan(options: ScanOptions): Promise<{ results, summary }>   // çok geçişli, tamamlanamayanları yeniden dener
  scanSingleProject(projectId, { orgId, apiKey, projectName?, limitTargets? }): Promise<ProjectScanResult>
  cancelScan(): void
  getScanProgress(): ScanProgress
  setProgressCallback(callback: Function): void
  setLogCallback(callback: Function): void
}
```
**Bağımlılık**: UnityCloudBuildService, CredentialManager, DatabaseService
**Davranış**:
- Her proje için `scanAndPersist()`: `scanProject()` sonucu tek seferde DB'ye yazılır (ikinci API turu yok)
- `lastScannedAt` yalnızca `completed` taramalarda set edilir
- Geçiş 1'de tamamlanamayan projeler 60 sn soğumadan sonra yeniden denenir (varsayılan 3 geçiş, `ScanOptions.maxPasses`)
- Rate limit tükenmesi veya 401'de scan tamamen durur; `summary.failedProjects` kalanları listeler
**Durum**: ✅ Tamamlandı

### 2. scan-registry ✅
**Dosya**: `src/modules/scanning/scan-registry.ts`
**Sorumluluk**: Süreç genelinde tek aktif scan kilidi (`getActiveScan`, `registerActiveScan`, `clearActiveScan`). `/api/scan` POST ikinci scan'i 409 ile reddeder, DELETE aktif scan'i iptal eder.

## Modüller Arası İlişkiler

```
CredentialManager → UnityCloudBuildService → ScanOrchestrator
               ↓                      ↓                ↓
         SetupWizard          ProjectProcessor    LogContext
                                        ↓              ↓
                              DatabaseService   LogPanel
