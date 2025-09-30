# Unity Cloud Build Multi-Project Cleaner - Proje Atlası

## Proje Amacı
Unity Cloud Build API'sini kullanarak çoklu Unity projelerini tek bir dashboard'dan yönetmeyi sağlayan web uygulaması. Kullanıcılar projelerini tarayabilir, build sayılarını görüntüleyebilir ve build verilerini analiz edebilir.

## Mimari Felsefe
- **API-First Approach**: Unity Cloud Build REST API'sini merkeze alan tasarım
- **Real-time Experience**: Canlı log sistemi ile kullanıcı deneyimini önceleyeme
- **Data Persistence**: SQLite ile lokal veri saklama
- **Progressive Enhancement**: Temel işlevsellik öncelikli, gelişmiş özellikler sonra

## Temel Teknoloji Tercihleri

### Backend
- **Next.js 15**: Full-stack React framework
- **Prisma**: Type-safe ORM
- **SQLite3**: Lokal veritabanı çözümü

### Frontend
- **React 19**: UI kütüphanesi
- **Mantine v7**: Kapsamlı UI component library
- **TanStack React Query**: Server state management
- **Tabler Icons**: Icon set

### Core Principles
1. **Simplicity**: Karmaşık kurulum gerektirmeyen plug-and-play yapı
2. **Transparency**: Her işlem için detaylı log ve feedback
3. **Reliability**: Hata durumlarında graceful degradation
4. **Performance**: Minimal resource kullanımı

## Proje Hedefi
Python scriptindeki işlevselliği modern web arayüzüne taşıyarak, Unity Cloud Build projelerinin yönetimini kullanıcı dostu hale getirmek.
