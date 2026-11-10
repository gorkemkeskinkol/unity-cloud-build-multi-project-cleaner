# Artifact Deletion

> Güncel akış: silme işleri job olarak çalışır (`docs/job-system.md`). Tek proje için `delete_builds`,
> tabloda seçilen birden çok proje için `delete_builds_bulk`. Toplu silmede projeler sırayla işlenir,
> sonunda sayılar tek bir org taramasıyla tazelenir. Tablodaki **Artifact'li** sütunu (artifact'i hâlâ duran
> başarılı build sayısı) silme sonrası sıfıra iner; **Build** sütunu build kayıtlarını saydığı için değişmez. System

## Genel Bakış
Unity Cloud Build'den build artifact'lerini silme özelliği, projelerin disk alanını yönetmek için kullanılır. Bu sistem, Unity Cloud Build API'sinin artifact silme endpoint'lerini kullanarak tüm build artifact'lerini (APK, IPA, vb.) kalıcı olarak siler.

## Önemli Notlar
- **Build metadata'ları silinmez**: Unity Cloud Build'deki build kayıtları (tarih, durum, vb.) korunur
- **Sadece artifact dosyaları silinir**: APK, IPA ve diğer binary dosyalar silinir
- **Geri alınamaz işlem**: Silinen artifact'ler geri getirilemez
- **Non-favorited builds**: Favorilenmemiş build'lerin artifact'leri silinir

## Mimari

### 1. Frontend Bileşenleri
**Dosya**: `src/app/page.tsx`

#### UI Bileşenleri:
- **Gear Menu Button**: Project tablosundaki her satırda ⚙️ ikonu
- **"Remove All Builds" Option**: Dropdown menüde kırmızı renkli, kalın yazılı buton
- **Confirmation Dialog**: İki aşamalı onay mekanizması
  - Proje adı gösterimi
  - Geri alınamaz işlem uyarısı
  - Cancel ve DELETE ARTIFACTS butonları

#### State Management:
```typescript
const [isDeletingBuilds, setIsDeletingBuilds] = useState(false);
const [showDeleteConfirm, setShowDeleteConfirm] = useState<{
  projectId: string;
  projectName: string;
} | null>(null);
```

### 2. Backend API Route
**Dosya**: `src/app/api/unity/orgs/[orgId]/projects/[projectId]/delete-builds/route.ts`

**Endpoint**: `DELETE /api/unity/orgs/[orgId]/projects/[projectId]/delete-builds`

**Headers**:
- `Content-Type: application/json`
- `x-api-key`: Unity Cloud Build API key

**Request Body**:
```json
{
  "updateCache": true  // Opsiyonel, varsayılan: true
}
```

**Response**: Server-Sent Events (SSE) stream
- `log` events: İşlem progress logları
- `complete` event: Sonuç özeti

### 3. Service Layer
**Dosya**: `src/modules/api/unity-cloud-build.ts`

#### deleteArtifactsForTarget
```typescript
async deleteArtifactsForTarget(
  projectId: string, 
  buildTargetId: string
): Promise<void>
```
Tek bir buildtarget'ın tüm artifact'lerini siler.

#### deleteAllBuildsForProject
```typescript
async deleteAllBuildsForProject(
  projectId: string,
  onProgress?: (current: number, total: number, targetName: string) => void
): Promise<{
  deletedTargets: number;
  totalTargets: number;
  errors: Array<{
    targetId: string;
    targetName: string;
    error: string;
  }>;
}>
```

Bir projenin tüm buildtarget'lerinin artifact'lerini siler.

**İşlem Akışı**:
1. Projenin tüm buildtarget'lerini listele
2. Her buildtarget için artifact silme endpoint'ini çağır
3. Progress callback ile ilerleme bildir
4. Rate limiting: ApiClient throttle (istekler arası 400 ms) + beklemeli retry
5. Hataları topla ve raporla

## Unity Cloud Build API Endpoint

**Endpoint**: `DELETE /orgs/{orgId}/projects/{projectId}/buildtargets/{targetId}/builds/artifacts`

**Açıklama**: "Delete all artifacts associated with all non-favorited builds for a specified buildtargetid"

## İş Akışı

### Kullanıcı Perspektifi:
1. Cached Projects tablosunda proje satırında ⚙️ ikonuna tıkla
2. Dropdown menüden "🗑️ Remove All Builds" seç
3. Confirmation dialog'da proje adını kontrol et
4. Uyarıyı oku ve "DELETE ARTIFACTS" butonuna tıkla
5. Log panelinde real-time progress izle
6. İşlem tamamlandığında sonuç bilgisini gör

### Sistem Perspektifi:
1. **Frontend**: Confirmation dialog göster
2. **Frontend**: Onay alındığında API route'a DELETE isteği gönder
3. **Backend**: SSE stream başlat
4. **Backend**: Buildtarget'leri listele
5. **Backend**: Her target için:
   - Artifact silme endpoint'ini çağır
   - Progress log event gönder
   - ApiClient throttle (rate limiting)
6. **Backend**: Sonuç özeti complete event olarak gönder
7. **Backend**: (Opsiyonel) Cache'i güncelle
8. **Frontend**: Cache'i reload et ve kullanıcıya bildir

## Error Handling

### Partial Success
Bazı target'lerde hata olursa:
- Başarılı olan target'ler silinir
- Hatalı olanlar error listesinde raporlanır
- Warning seviyesinde log oluşturulur

### Complete Failure
Buildtarget listesi alınamazsa:
- İşlem durdurulur
- Error log oluşturulur
- Kullanıcıya hata mesajı gösterilir

### Rate Limiting
API rate limit'e takılırsa (HTTP 429 veya abuse detection mesajlı 403):
- ApiClient aynı isteği 1 → 2 → 5 → 10 → 15 dk beklemelerle tekrar dener (en fazla 10 deneme)
- Her bekleme SSE log olarak kullanıcıya anında gösterilir ("Unity API geçici olarak engelledi ... 60 sn bekleniyor")
- Blok durumu süreç genelinde paylaşılır: aynı anda süren bir scan varsa o da bekler, Unity ayrı ayrı yoklanmaz
- Beklemeler tükenirse veya API key geçersizse (401) silme işlemi **durur**, sonraki target'lar atlanmaz ve kullanıcıya "daha sonra tekrar deneyin" hatası gösterilir
- Tarayıcı bağlantıyı koparırsa (sekme kapandı) süren beklemeler iptal edilir
- İstekler arası en az 400 ms throttle uygulanır (`UNITY_API_MIN_INTERVAL_MS`)

## Güvenlik Önlemleri

1. **İki Aşamalı Onay**:
   - Gear menüde buton tıklaması
   - Confirmation dialog'da onay

2. **Görsel Uyarılar**:
   - Kırmızı renk vurgusu
   - "Geri alınamaz" uyarı metni
   - Sarı renkli dikkat kutusu

3. **API Key Protection**:
   - API key sadece header'da gönderilir
   - Server-side validation yapılır

4. **Rate Limiting**:
   - İstekler arası 400 ms throttle (ApiClient, tüm instance'lar ortak)
   - Rate limit'te dakikalık beklemeli retry; beklemeler SSE log ile bildirilir

## Cache Yönetimi

### Otomatik Cache Güncelleme (v2 - Güncel)
Artifact silme işleminden sonra:
1. Cache temizleme endpoint'i çağrılır
2. **Proje tekrar taranır ve güncel bilgilerle cache'e eklenir**
3. Frontend otomatik olarak cache'i reload eder
4. Proje listede güncel bilgilerle görünür

**Önemli**: Proje cache'den silinir, ardından güncel bilgileriyle tekrar taranıp cache'e eklenir. Böylece proje listeden kaybolmaz ve her zaman güncel durumu yansıtır.

**Not**: Build sayıları aynı kalır çünkü sadece artifact'ler silinir, build metadata'ları Unity'de kalır

### Re-scan İşlemi Detayları
Build silme sonrası yapılan re-scan işlemi:
- `ScanOrchestrator.scanSingleProject()` metodu kullanılır
- Sadece ilgili proje taranır (tüm projeler değil)
- Build target'leri ve build sayıları güncel olarak alınır
- `lastScannedAt` timestamp'i güncellenir
- Cache'e geri eklenir
- Hata durumunda: Warning log gösterilir, kullanıcı manuel scan yapabilir

## Log Mesajları

### Info Seviyesi:
- `"[ProjectName]" projesinin tüm artifact'leri siliniyor...`
- `Proje [projectId] için [X] target bulundu`
- `Deleting artifacts for [targetName] ([X]/[Y])...`
- `Cache güncelleniyor...`

### Success Seviyesi:
- `✓ [targetName] artifact'leri silindi ([X]/[Y])`
- `✓ Tüm artifact'ler silindi ([X] target)`
- `✓ Cache temizlendi`

### Warning Seviyesi:
- `Artifact silme tamamlandı ([X]/[Y] başarılı)`
- `Cache temizleme başarısız`

### Error Seviyesi:
- `[targetName]: [error details]`
- `Delete builds hatası: [error message]`

## Performance Considerations

### Optimizasyonlar:
- SSE kullanarak real-time feedback
- İstekler arası 400 ms throttle ile rate limiting
- Parallel olmayan sequential işlem (API rate limit nedeniyle)
- Tek target'ta kalıcı hata (404 vb.) olursa diğer target'lere devam etme; rate limit tükenmesi / 401'de durma

### Beklenen Süre:
- 1 target: ~1 saniye
- 10 target: ~3-5 saniye
- 50 target: ~10-15 saniye

(Network latency ve API response time'a bağlı olarak değişebilir)

## Known Limitations

1. **Favorited Builds**: Favorilenmmiş build'lerin artifact'leri silinmez
2. **Build Metadata**: Build kayıtları Unity'de kalır
3. **Sequential Processing**: Target'ler sırayla işlenir (parallel değil)
4. **No Rollback**: Hata durumunda önceki silinen artifact'ler geri gelmez

## Future Enhancements

1. **Bulk Project Deletion**: Birden fazla projenin artifact'lerini aynı anda silme
2. **Selective Deletion**: Belirli platformlar veya tarih aralıklarına göre silme
3. **Storage Savings Report**: Silinen artifact'lerin toplam boyutu raporu
4. **Dry Run Mode**: Gerçek silme yapmadan önce ne silineceğini gösterme
