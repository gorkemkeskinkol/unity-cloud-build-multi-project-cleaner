# İş Süreçleri

## 1. Uygulama Başlatma ve İlk Kurulum

### Veri Akışı
```
Uygulama Açılışı
    ↓
CredentialManager.getCredentials()
    ↓
[Credentials var mı?]
    ├─ HAYIR → SetupWizard göster
    │           ↓
    │       Kullanıcı bilgi girer
    │           ↓
    │       SettingsValidator.validate()
    │           ↓
    │       UnityCloudBuildService.sanityCheckOrg()
    │           ↓
    │       CredentialManager.storeCredentials()
    │           ↓
    │       Dashboard'a yönlendir
    │
    └─ EVET → Dashboard'a yönlendir
```

### Kritik Noktalar
- Cache TTL: varsayılan 1 hafta (`DEFAULT_CACHE_MAX_AGE_MS`, `src/modules/config/cache-config.ts`); hem Cached Projects listesi hem scan'deki cache kontrolü aynı değeri kullanır. `cacheMaxAgeMs` ile scan bazında değiştirilebilir
- `lastScannedAt` yalnızca eksiksiz tamamlanan taramalarda set edilir (partial/failed projeler cache sayılmaz)
- Cache kontrolü her scan'de proje bazında yapılır
- Cache temizleme işlemi cascade delete ile ilgili tüm verileri siler
- Cache'den gelen projeler status'ünde görsel olarak işaretlenir
- Bulk cache clearing birden fazla projeyi tek transactionda temizler
- Cache miss durumunda otomatik API fallback

---

## 8. Project Table Sorting

### Veri Akışı
```
User clicks "Total Builds" header (Dashboard UI - src/app/page.tsx)
    ↓
handleSortToggle('totalBuilds') function called
    ↓
setSortOptions() updates state (toggle asc/desc)
    ↓
useEffect with dependency [sortOptions] in Dashboard triggers
    ↓
cachedProjects state updated with sorted array
    ↓
Table re-renders with projects ordered by totalBuilds

Data reload scenarios (scan complete, cache clear):
    ↓
fetch('/api/cache/projects') returns raw data
    ↓
Array copied and sorted client-side using current sortOptions
    ↓
setCachedProjects with sorted data
    ↓
Table displays in sorted order

Sort Logic:
- Primary: totalBuilds (numeric, null=0)
- Secondary: name (alphabetical for ties)
- Default: desc (highest build count first)
```

### Kritik Noktalar
- Client-side sorting for performance (small n, O(n log n) negligible)
- Sorting applied on every data reload (initial mount, scan complete, cache ops)
- UI indicator: ↓ for descending, ↑ for ascending
- No server-side changes or API params needed
- Handles missing totalBuilds as 0
- Locale-sensitive name comparison (Turkish locale)
- Sorting preserved across interactions without extra fetches
- Local storage kontrolü uygulama her açılışında yapılır
- API key validasyonu gerçek Unity API çağrısı ile test edilir
- Hatalı credentials durumunda kullanıcı SetupWizard'a geri döner

---

## 2. Project Scanning ve Veri Toplama (Job Sistemi)

> Tarama ve artifact silme artık **job** olarak çalışır: sıralı, kalıcı, servis
> yeniden başlasa da devam eden. Detay: `docs/job-system.md`.

### Veri Akışı
```
Kullanıcı "Start Full Scan" butonuna tıklar (Dashboard - client-side)
    ↓
POST /api/jobs { type: 'full_scan', params, credentials }
    ├─ Credentials validation → 401 / 400
    ├─ Job kaydı (status: queued) + credentials runner belleğine (DB'ye yazılmaz)
    └─ 202 { job }
    ↓
JobRunner (tek işçi) sıradaki job'ı alır → running
    ↓
ScanOrchestrator.startScan(options, hooks) çağrılır
    ├─ options.credentials kullanılır (localStorage DEĞİL!)
    ├─ Log callback → JobEventBus 'log' → SSE → LogPanel
    └─ hooks (onProjectStart/onProjectResult/onWait...) → JobItem + Job.progress → SSE → JobsPanel
    ↓
[GERÇEK ZAMANLI STREAMING: GET /api/jobs/events (EventSource)]
    ↓
UnityCloudBuildService.listProjects()
    ├─ Log Event → SSE stream → Client LogContext.addLog()
    └─ Client UI ANINDA güncellenir
    ↓
ScanOrchestrator.scanAndPersist() (her proje için sıralı)
    ├─ Her adımda:
    │   ├─ Log Event → SSE stream → Client
    │   ├─ Progress Event → SSE stream → Client (pass, pendingProjects dahil)
    │   └─ Client UI GERÇEK ZAMANLI güncellenir
    ├─ UnityCloudBuildService.scanProject()
    │   ├─ listBuildTargets() (1 istek)
    │   └─ countBuilds() (her target için 1 istek)
    └─ DatabaseService.* (sonuç, target'lar, sayımlar; completed ise lastScannedAt)
    ↓
Tamamlanamayan projeler için yeniden deneme geçişleri (bkz. Bölüm 6)
    ↓
Scan tamamlanır
    ├─ Job → completed, result = summary (failedProjects dahil)
    └─ 'job' event → Dashboard "Son Full Scan Özeti" ve JobsPanel güncellenir
```

Tarayıcı sekmesi kapansa da job sürer (credentials runner belleğinde). Servis kapanırsa job
`interrupted` olur ve dashboard açıldığında otomatik resume edilir.

### Job Endpoint'leri
- `GET /api/jobs`, `POST /api/jobs`, `GET /api/jobs/[id]`, `POST /api/jobs/[id]/cancel`,
  `POST /api/jobs/[id]/resume`, `GET /api/jobs/events` (bkz. `docs/job-system.md`)

### SSE Event Tipleri (`GET /api/jobs/events`)
0. **backlog** - Bağlanınca son 300 log (geç açılan sekme için)
1. **log** - Her log mesajı için
   ```json
   {
     "level": "info|warning|error|success",
     "message": "Log mesajı",
     "source": "Kaynak modül",
     "timestamp": "ISO timestamp"
   }
   ```

2. **job** - Job kaydı her değiştiğinde (status, progress, result)
   ```json
   {
     "kind": "job",
     "job": { "id": "...", "type": "full_scan", "status": "running",
              "progress": { "total": 264, "done": 120, "failed": 2, "phase": "Taranıyor", "currentName": "Hyper X" } }
   }
   ```

### Kritik Noktalar
- **Real-time streaming**: Log'lar oluşturulduğu anda client'a ulaşır
- **SSE (Server-Sent Events)** standardı kullanılır (WebSocket değil)
- **Credentials client'dan server'a HTTP request body ile gönderilir**, veritabanına yazılmaz
- Server-side credentials localStorage'a erişemez (window object yok); bu yüzden resume için dashboard açık olmalı
- Her log server'da oluşturulur ve anında SSE event olarak stream edilir
- Hata durumlarında partial results korunur
- Progress tracking gerçek zamanlı olarak client'a iletilir
- Database yazma işlemi her proje tamamlandığında yapılır (server-side)
- Stream tamamlandığında connection otomatik kapanır
- Client-side ReadableStream API ile event'ler parse edilir

---

## 3. Real-time Log Yönetimi

### Veri Akışı
```
Herhangi bir işlem başlatılır
    ↓
İlgili modül LogContext.addLog() çağırır
    ↓
LogContext state güncelenir
    ↓
LogPanel Component re-render olur
    ↓
[Log seviyesi ERROR ise]
    ├─ NotificationService.showError()
    └─ Log paneli otomatik açılır (if closed)
    ↓
[Log seviyesi SUCCESS ise]
    └─ NotificationService.showSuccess()
```

### Kritik Noktalar
- Log seviyesi: INFO, WARNING, ERROR, SUCCESS
- Log paneli her zaman erişilebilir (sticky/floating)
- Error durumlarında notification + log panel kombinasyonu
- Log history sayfa yenilenmelerinde korunur (session storage)

---

## 4. Configuration Management

### Veri Akışı
```
Kullanıcı settings sayfasına gider
    ↓
CredentialManager.getCredentials() (mevcut değerler için)
    ↓
ConfigForm bileşeni populate edilir
    ↓
Kullanıcı değişiklik yapar ve submit eder
    ↓
SettingsValidator.validate() (form validation)
    ↓
[Validation başarılı ise]
    ├─ UnityCloudBuildService.sanityCheckOrg() (API test)
    ├─ [API test başarılı ise]
    │   ├─ CredentialManager.storeCredentials()
    │   ├─ LogContext.addLog("Settings updated")
    │   └─ NotificationService.showSuccess()
    │
    └─ [API test başarısız ise]
        ├─ Form error state göster
        ├─ LogContext.addLog("Invalid credentials", ERROR)
        └─ NotificationService.showError()
```

### Kritik Noktalar
- Credential değişiklikleri anında test edilir
- Local storage update ancak validation geçince yapılır
- Settings değişikliği cache invalidation tetikler

---

## 5. Data Persistence ve History

### Veri Akışı
```
ScanOrchestrator scan tamamlar
    ↓
DatabaseService.saveScanResult() (metadata ile)
    ↓
[Proje verileri için]
    ├─ DatabaseService.saveProject()
    └─ DatabaseService.saveBuildTarget() (her target için)
    ↓
UI History sekmesi güncellemesi
    ↓
React Query cache güncellenir
```

### Kritik Noktalar
- Scan metadata: timestamp, kullanıcı, scan parametreleri
- Historical data comparison için önceki scan results korunur
- Database writes transactional (tek scan = tek transaction)
- UI'da infinite scroll ile history pagination

---

## 6. Error Handling ve Recovery

### Veri Akışı
```
API çağrısında hata oluşur
    ↓
ApiClient error handling devreye girer
    ↓
[Hata tipi nedir?]
    ├─ Network Error → Retry logic (3 kez)
    ├─ Auth Error → Credentials invalid notification
    ├─ Rate Limit (403) → Exponential backoff + retry (2s, 4s, 8s)
    └─ Server Error → Log + user notification
    ↓
LogContext.addLog(error details, ERROR)
    ↓
NotificationService.showError(user-friendly message)
    ↓
[Kritik hata ise]
    └─ ScanOrchestrator.cancelScan()
```

### Rate Limiting Mekanizması (ApiClient.request)
```
Her istek önce throttle'dan geçer (hepsi static: scan + artifact silme tek pencere)
    ├─ Daha önce rate limit alındıysa blockedUntil dolana kadar hiçbir istek atılmaz
    ├─ İki istek arası en az UNITY_API_MIN_INTERVAL_MS (varsayılan 1000 ms)
    ├─ Kayan 60 sn penceresinde en fazla UNITY_API_MAX_PER_MINUTE istek (varsayılan 60;
    │   Unity'nin belgelenmiş limiti 100/dk, bilerek altında)
    └─ X-RateLimit-Remaining ≤ 10 ise X-RateLimit-Reset'e kadar beklenir
    ↓
Yanıt sınıflandırılır (ApiError.kind)
    ├─ rate_limit  → HTTP 429, veya gövdesinde "abuse detection / temporarily blocked" geçen HTTP 403
    │     Sunucu süre söylüyorsa (Retry-After, "retry in N seconds", X-RateLimit-Reset) o kadar + 2 sn;
    │     söylemiyorsa (abuse 403 söylemiyor) 1 → 2 → 5 → 10 → 15 dk (max 10 deneme)
    │     Bekleme boyunca diğer tüm istekler de bekler (blockedUntil, tüm ApiClient instance'ları ortak)
    ├─ server / network → 5xx, timeout, fetch hatası: 3s → 6s → 12s → 24s (max 5 deneme)
    ├─ forbidden   → abuse mesajı olmayan düz 403: 5s, 2 deneme (gerçek yetki hatası olabilir)
    └─ auth / not_found / client → 401, 404, diğer 4xx: hemen fırlatılır, tekrar denenmez
    ↓
Her bekleme onWait callback'i ile ScanOrchestrator'a bildirilir
    └─ SSE log: "Unity API geçici olarak engelledi ... 60 sn bekleniyor (deneme 2/12)"
    ↓
Bekleme sırasında shouldCancel kontrol edilir (1 sn aralıklarla)
    └─ Kullanıcı iptal ederse CancelledError fırlatılır
```

### Tamamlanamayan Projelerin Yeniden Denenmesi (ScanOrchestrator.startScan)
```
Geçiş 1: tüm projeler sırayla taranır
    ├─ status = completed → sonuç kaydedilir, lastScannedAt set edilir
    └─ status = partial / failed → sonuç kaydedilir, lastScannedAt set EDİLMEZ, kuyruğa eklenir
    ↓
[Kuyruk boş değilse ve geçiş hakkı varsa]  (varsayılan maxPasses = 3)
    ├─ 60 sn soğuma beklenir
    └─ Geçiş N: yalnızca kuyruktaki projeler yeniden taranır
    ↓
Scan sonu
    ├─ Hepsi tamamlandı → SUCCESS log
    └─ Kalan varsa → ERROR log + summary.failedProjects listesi (UI'da kırmızı kutu)
```

### Kritik Noktalar
- 403'ün **gövdesine** bakılır: abuse detection mesajı rate limit sayılır, diğer 403'ler yetki hatası
- Scan artık `/orgs/{org}/builds` sanity check'i yapmaz (org'daki tüm build'leri listeleyen en ağır istek); auth kontrolü proje listesiyle olur
- Rate limit beklemeleri saniyelik değil **dakikalık**; Unity'nin bloğu bitmeden tekrar istek atmak bloğu uzatır
- Gözlem (10 Kas 2026): belgelerdeki 429 hiç görülmedi; ~130 istek/dk hızında 59 proje sonra doğrudan abuse 403 geldi,
  eski kodun 2-4 sn'lik retry'ları banı saatlerce uzattı. Bu yüzden asıl savunma limiti hiç aşmamak
- Rate limit 12 denemede de geçmezse veya API key geçersizse (401) scan **tamamen durur**; proje atlanmaz
- Tek bir target'ta kalıcı hata (404 vb.) projeyi `partial` yapar, scan sürer
- Yarım kalan projeler cache'e alınmaz; hem aynı scan içindeki sonraki geçişlerde hem de bir sonraki scan'de otomatik yeniden denenir
- Partial results korunur ve kullanıcıya sunulur

---

## 7. Cache Management ve Project Scanning

### Veri Akışı
```
ScanOrchestrator.startScan() başlatılır
    ↓
DatabaseService.getInstance()
    ↓
Organization database'e kaydedilir
    ↓
[Her proje için]
    ├─ DatabaseService.isProjectCached(projectId, cacheMaxAgeMs)
    │   ↓
    ├─ [Cache HIT]
    │   ├─ DatabaseService.getProject(projectId)
    │   ├─ DatabaseService.getLatestScanResult(projectId)
    │   ├─ Result'a isFromCache=true ile ekle
    │   └─ LogContext.addLog("Cache'den çekildi", SUCCESS)
    │
    └─ [Cache MISS veya EXPIRED]
        ├─ UnityCloudBuildService.scanProject(): target listesi + her target için build sayısı
        │   (tek seferde; aynı veri ikinci kez API'den çekilmez)
        ├─ DatabaseService.saveProject() (lastScannedAt DOKUNULMAZ)
        ├─ DatabaseService.saveScanResult()
        ├─ DatabaseService.saveBuildTarget() (her target için)
        ├─ DatabaseService.saveBuildCount() (sayımı alınabilen her target için)
        ├─ [status === completed] DatabaseService.saveProject(lastScannedAt = now)
        ├─ [status !== completed] lastScannedAt set edilmez → yeniden deneme kuyruğuna girer
        ├─ Result'a isFromCache=false ile ekle
        └─ LogContext.addLog("API'den tarandı", SUCCESS)
```

Cache HIT yalnızca son ScanResult'ın status'ü `completed` ise geçerlidir; eski partial kayıtlar yeniden taranır.

### Cache Temizleme Workflow
```
Kullanıcı "Remove from Cache" seçer
    ↓
[Tek proje mi, çoklu proje mi?]
    ├─ Tek Proje
    │   ├─ DELETE /api/cache/[projectId]
    │   └─ DatabaseService.clearProjectCache(projectId)
    │
    └─ Çoklu Proje (Bulk)
        ├─ POST /api/cache/bulk
        └─ DatabaseService.bulkClearProjectsCache(projectIds[])
    ↓
ScanResult ve BuildCount kayıtları silinir
    ↓
Project.lastScannedAt = null olarak güncellenir
    ↓
UI güncellenir (cache status değişir)
    ↓
NotificationService.showSuccess("Cache temizlendi")
```

### Kritik Noktalar
- Cache TTL: varsayılan 1 hafta (`DEFAULT_CACHE_MAX_AGE_MS`, `src/modules/config/cache-config.ts`); hem Cached Projects listesi hem scan'deki cache kontrolü aynı değeri kullanır. `cacheMaxAgeMs` ile scan bazında değiştirilebilir
- `lastScannedAt` yalnızca eksiksiz tamamlanan taramalarda set edilir (partial/failed projeler cache sayılmaz)
- Cache kontrolü her scan'de proje bazında yapılır
- Cache temizleme işlemi cascade delete ile ilgili tüm verileri siler
- Cache'den gelen projeler status'ünde görsel olarak işaretlenir
- Bulk cache clearing birden fazla projeyi tek transactionda temizler
- Cache miss durumunda otomatik API fallback
