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
- Cache TTL (Time To Live): Default 1 saat (cacheMaxAgeMs parametresi ile ayarlanabilir)
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

## 2. Project Scanning ve Veri Toplama (Server-Side SSE)

### Veri Akışı
```
Kullanıcı "Scan Projects" butonuna tıklar (Dashboard - client-side)
    ↓
fetch('/api/scan', { credentials, limitProjects, ... })
    ↓
POST /api/scan endpoint (server-side)
    ├─ Request body'den credentials alınır
    ├─ Credentials validation (orgId, apiKey kontrolü)
    └─ [Validation başarısız ise] → 401 Unauthorized döner
    ↓
SSE Stream başlatılır (ReadableStream)
    ↓
ScanOrchestrator.startScan(options) çağrılır
    ├─ options.credentials kullanılır (localStorage DEĞİL!)
    ├─ Log callback set edilir → SSE event olarak stream edilir
    └─ Progress callback set edilir → SSE event olarak stream edilir
    ↓
[GERÇEK ZAMANLI STREAMING BAŞLAR]
    ↓
UnityCloudBuildService.listProjects()
    ├─ Log Event → SSE stream → Client LogContext.addLog()
    └─ Client UI ANINDA güncellenir
    ↓
ProjectProcessor.process() (her proje için sıralı)
    ├─ Her adımda:
    │   ├─ Log Event → SSE stream → Client
    │   ├─ Progress Event → SSE stream → Client  
    │   └─ Client UI GERÇEK ZAMANLI güncellenir
    ├─ UnityCloudBuildService.listBuildTargets()
    ├─ UnityCloudBuildService.countBuilds() (her target için)
    └─ DatabaseService.saveProject() (işlem tamamında)
    ↓
Scan tamamlanır
    ├─ Complete Event → SSE stream → Client
    │   ├─ { results, summary } içerir
    │   └─ Client final state'i alır
    └─ SSE stream kapatılır (controller.close())
    ↓
Client connection kapanır
    ↓
Dashboard final verileri gösterir
```

### SSE Event Tipleri
1. **log** - Her log mesajı için
   ```json
   {
     "level": "info|warning|error|success",
     "message": "Log mesajı",
     "source": "Kaynak modül",
     "timestamp": "ISO timestamp"
   }
   ```

2. **progress** - İlerleme güncellemeleri için
   ```json
   {
     "currentProject": 3,
     "totalProjects": 5,
     "currentProjectName": "Proje Adı",
     "isScanning": true
   }
   ```

3. **complete** - Scan tamamlandığında
   ```json
   {
     "results": [...],
     "summary": {...}
   }
   ```

4. **error** - Hata oluştuğunda
   ```json
   {
     "message": "Hata mesajı"
   }
   ```

### Kritik Noktalar
- **Real-time streaming**: Log'lar oluşturulduğu anda client'a ulaşır
- **SSE (Server-Sent Events)** standardı kullanılır (WebSocket değil)
- **Credentials client'dan server'a HTTP request body ile gönderilir**
- Server-side credentials localStorage'a erişemez (window object yok)
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

### Rate Limiting Mekanizması
```
Unity API 403 döndürür (abuse detection)
    ↓
ApiClient retry logic devreye girer
    ├─ 1. Deneme başarısız → 2 saniye bekle
    ├─ 2. Deneme başarısız → 4 saniye bekle
    └─ 3. Deneme başarısız → 8 saniye bekle
    ↓
[Tüm denemeler başarısız ise]
    └─ ApiError throw et (HTTP 403)
```

### Proje Tarama Rate Limiting
```
Her proje taraması tamamlandığında:
    ↓
500ms bekleme (Unity API abuse detection için)
    ↓
Bir sonraki projeye geç
```

### Kritik Noktalar
- Network errors için automatic retry
- Authentication errors için immediate user feedback
- **Rate limiting (403) için exponential backoff** (2s → 4s → 8s)
- **Proje taramaları arası 500ms delay** (Unity API abuse detection)
- Partial results korunur ve kullanıcıya sunulur
- Retry mekanizması maksimum 3 deneme yapar

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
        ├─ Unity API'den proje taranır
        ├─ DatabaseService.saveProject() (lastScannedAt güncellenir)
        ├─ DatabaseService.saveScanResult()
        ├─ DatabaseService.saveBuildTarget() (her target için)
        ├─ DatabaseService.saveBuildCount() (her target için)
        ├─ Result'a isFromCache=false ile ekle
        └─ LogContext.addLog("API'den tarandı", SUCCESS)
```

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
- Cache TTL (Time To Live): Default 1 saat (cacheMaxAgeMs parametresi ile ayarlanabilir)
- Cache kontrolü her scan'de proje bazında yapılır
- Cache temizleme işlemi cascade delete ile ilgili tüm verileri siler
- Cache'den gelen projeler status'ünde görsel olarak işaretlenir
- Bulk cache clearing birden fazla projeyi tek transactionda temizler
- Cache miss durumunda otomatik API fallback
