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
- Local storage kontrolü uygulama her açılışında yapılır
- API key validasyonu gerçek Unity API çağrısı ile test edilir
- Hatalı credentials durumunda kullanıcı SetupWizard'a geri döner

---

## 2. Project Scanning ve Veri Toplama

### Veri Akışı
```
Kullanıcı "Scan Projects" butonuna tıklar
    ↓
ScanOrchestrator.startScan() çağrılır
    ↓
LogContext.addLog("Scan başladı")
    ↓
UnityCloudBuildService.listProjects()
    ↓
ProjectProcessor.process() (her proje için paralel)
    ├─ UnityCloudBuildService.listBuildTargets()
    ├─ UnityCloudBuildService.countBuilds() (her target için)
    ├─ LogContext.addLog(progress) (her adımda)
    └─ DatabaseService.saveProject() (işlem tamamında)
    ↓
ScanOrchestrator.getScanProgress() (UI güncellemesi için)
    ↓
NotificationService.showSuccess() veya showError()
    ↓
Dashboard verileri güncellenir (React Query cache invalidation)
```

### Kritik Noktalar
- Her API çağrısı öncesi ve sonrası log kaydı
- Hata durumlarında partial results korunur
- Progress tracking kullanıcı experience için kritik
- Database yazma işlemi her proje tamamlandığında yapılır

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
    ├─ Rate Limit → Delay + retry
    └─ Server Error → Log + user notification
    ↓
LogContext.addLog(error details, ERROR)
    ↓
NotificationService.showError(user-friendly message)
    ↓
[Kritik hata ise]
    └─ ScanOrchestrator.cancelScan()
```

### Kritik Noktalar
- Network errors için automatic retry
- Authentication errors için immediate user feedback
- Rate limiting için intelligent backoff
- Partial results korunur ve kullanıcıya sunulur
