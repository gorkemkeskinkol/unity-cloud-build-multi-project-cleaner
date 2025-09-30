# Alt Sistemler

## 1. Configuration Management System (CMS)
**Sorumluluk**: Unity Cloud Build API credentials ve uygulama ayarlarının yönetimi

### Ana İşlevler
- API key ve organization ID validasyonu
- Local storage ile güvenli credential saklama
- Ayar değişikliklerinin real-time kontrolü
- İlk kurulum wizard'ı

### Teknolojiler
- Browser Local Storage API
- Mantine Form validation
- Base64 encoding (Python scripti uyumluluğu için)

---

## 2. Unity Cloud Build API Integration (UCBAI)
**Sorumluluk**: Unity Cloud Build REST API ile iletişim (CORS çözümü ile server-side proxy)

### Ana İşlevler
- Organizations, projects, build targets listeleme
- Build count sayma işlemleri
- HTTP error handling ve retry logic
- Rate limiting ve timeout yönetimi
- CORS bypass için Next.js API routes proxy

### Teknolojiler
- Next.js API Routes (server-side proxy)
- Fetch API (client-side)
- Custom API client abstraction
- Server-side Unity API authentication

### Mimarisi
- **Client-side**: `/api/unity/` endpoints'lerini çağırır
- **Server-side**: Unity Cloud Build API'sine proxy yapar
- **Güvenlik**: API key'ler server-side environment'ta kalır

---

## 3. Database Management System (DMS) 
**Sorumluluk**: SQLite veritabanı işlemleri, veri modeli yönetimi ve cache sistemi

### Ana İşlevler
- Proje, build target ve build count verilerinin saklanması
- Geçmiş scan sonuçlarının tutulması
- Cache management (time-based TTL)
- Bulk operations (çoklu proje cache temizleme)
- Data migration ve schema versioning
- Query optimization ve indexing

### Cache Sistemi
- **Time-based Caching**: lastScannedAt + TTL kontrolü ile
- **Default TTL**: 1 saat (cacheMaxAgeMs ile yapılandırılabilir)
- **Cache Operations**:
  - `isProjectCached()`: Proje cache durumu kontrolü
  - `clearProjectCache()`: Tek proje cache temizleme
  - `bulkClearProjectsCache()`: Çoklu proje cache temizleme
  - `getCachedProjects()`: Cache'lenmiş projeleri listeleme

### Veri Modeli
- **Organization**: Unity Cloud Build organizasyonu
- **Project**: Unity projeleri (lastScannedAt ile cache tracking)
- **BuildTarget**: Proje build hedefleri
- **ScanResult**: Tarama sonuçları (metadata ve status)
- **BuildCount**: Her target için build sayıları
- **LogEntry**: İşlem log kayıtları

### Teknolojiler
- Prisma ORM (Type-safe database client)
- SQLite3 (Local file-based database)
- Singleton pattern (DatabaseService)
- Cascade delete operations
- Transaction support

---

## 4. Real-time Logging System (RLS)
**Sorumluluk**: Kullanıcıya anlık işlem feedback'i sağlama

### Ana İşlevler
- API çağrıları sırasında progress tracking
- Error ve success mesajlarının görüntülenmesi
- Log history ve filtering
- Mantine notifications entegrasyonu

### Teknolojiler
- React Context API / Zustand
- Mantine Notifications
- WebSocket (gelecek versiyonlar için hazırlık)

---

## 5. User Interface System (UIS)
**Sorumluluk**: Kullanıcı arayüzü bileşenleri ve etkileşimleri

### Ana İşlevler
- Dashboard layout ve navigation
- Project ve build data visualizasyonu
- Responsive design ve accessibility
- Form handling ve validation

### Teknolojiler
- Mantine Core components
- Mantine Hooks
- Tabler Icons
- CSS Modules / Mantine styles

---

## 6. Data Collection & Processing System (DCPS)
**Sorumluluk**: Python scriptinin Node.js karşılığı işlem mantığı

### Ana İşlevler
- Multi-project batch processing
- Parallel API request management
- Progress calculation ve reporting
- Error recovery ve partial results

### Teknolojiler
- Promise.all / Promise.allSettled
- Custom async iterators
- Background job processing
