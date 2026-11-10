# Unity Cloud Build Multi-Project Cleaner

A modern web dashboard for managing multiple Unity Cloud Build projects. Built with Next.js, this tool allows you to scan, monitor, and analyze build data across all your Unity projects from a single interface.

## Features

✅ **Real-time Project Scanning**: Scan all projects in your Unity organization with live progress tracking  
✅ **Python Script Compatibility**: Full Node.js/TypeScript port of the original Python functionality  
✅ **Live Logging**: Real-time log panel showing all API operations and progress  
✅ **Local Storage**: Secure credential management with browser local storage  
✅ **SQLite Database**: Persistent storage for scan results and historical data  
✅ **Error Handling**: Robust error handling with partial results support  
✅ **Rate Limiting**: Built-in delays to respect Unity API limits  

## Architecture

### Core Modules
- **API Client**: Unity Cloud Build REST API integration
- **Scan Orchestrator**: Multi-project scanning coordinator (Python script equivalent)
- **Credential Manager**: Secure API key and org ID management
- **Real-time Logging**: Live feedback system for all operations
- **Database Layer**: SQLite with Prisma ORM for data persistence

### Technology Stack
- **Frontend**: Next.js 15 + React 19
- **UI Library**: Mantine v7 (planned)
- **Database**: SQLite + Prisma ORM
- **State Management**: TanStack React Query + React Context
- **Language**: TypeScript with strict mode

## Project Structure

```
├── docs/                     # Documentation system
│   ├── project-atlas.md      # Project overview and philosophy
│   ├── subsystems.md         # High-level system components
│   ├── module-maps.md        # Detailed module relationships
│   └── business-processes.md # Data flow and business logic
├── src/
│   ├── app/                  # Next.js app directory (api/jobs/** job rotaları)
│   ├── components/           # JobsPanel
│   ├── hooks/                # useJobs (SSE + otomatik resume)
│   ├── components/           # React components (planned)
│   ├── contexts/             # React contexts
│   │   └── LogContext.tsx    # Global logging state
│   ├── modules/              # Core business logic
│   │   ├── api/              # Unity Cloud Build API integration
│   │   ├── config/           # Configuration management
│   │   ├── jobs/             # Job store, event bus, runner
│   │   └── scanning/         # Project scanning logic
│   └── types/                # TypeScript type definitions
├── prisma/
│   └── schema.prisma         # Database schema
└── package.json              # Dependencies and scripts
```

## Setup Instructions

### Prerequisites
- Node.js 18+ 
- npm or yarn

### Installation

1. **Clone and install dependencies:**
   ```bash
   git clone <repository-url>
   cd unity-cloud-build-multi-project-cleaner
   npm install
   ```

2. **Set up the database:**
   ```bash
   npm run db:push
   npm run db:generate
   ```

3. **Start development server:**
   ```bash
   npm run dev
   ```

4. **Configure Unity Cloud Build credentials:**
   - Open http://localhost:3000
   - Enter your Unity Organization ID
   - Enter your Unity Cloud Build API Key
   - Click "Validate & Save"

### Getting Unity Cloud Build Credentials

1. **Organization ID**: Found in Unity Cloud Build dashboard URL or organization settings
2. **API Key**: Generate from Unity Cloud Build → Settings → API → New API Key

## Python Script Compatibility

This project is a complete port of the original Python script with the following equivalencies:

| Python Function | Node.js Equivalent | Status |
|---|---|---|
| `get()` | `ApiClient.get()` | ✅ Complete |
| `content_range_total()` | `ApiClient.getContentRangeTotal()` | ✅ Complete |
| `sanity_check_org_has_builds()` | `UnityCloudBuildService.sanityCheckOrg()` | ✅ Complete |
| `list_projects()` | `UnityCloudBuildService.listProjects()` | ✅ Complete |
| `list_build_targets()` | `UnityCloudBuildService.listBuildTargets()` | ✅ Complete |
| `count_builds_for_target()` | `UnityCloudBuildService.countBuilds()` | ✅ Complete |
| `main()` | `ScanOrchestrator.startScan()` | ✅ Complete |

## Usage

### Basic Scanning
```typescript
import { ScanOrchestrator } from '@/modules/scanning/scan-orchestrator';
import { useLog } from '@/contexts/LogContext';

const scanner = new ScanOrchestrator();
const { addLog } = useLog();

// Set up callbacks
scanner.setLogCallback(addLog);
scanner.setProgressCallback((progress) => {
  console.log(`Progress: ${progress.currentProject}/${progress.totalProjects}`);
});

// Start scanning
const result = await scanner.startScan({
  limitProjects: 5,  // Optional: limit number of projects
  limitTargets: 10   // Optional: limit build targets per project
});

console.log(`Scanned ${result.summary.totalProjects} projects`);
console.log(`Found ${result.summary.totalBuilds} total builds`);
```

### Credential Management
```typescript
import { CredentialManager } from '@/modules/config/credential-manager';

// Store credentials
CredentialManager.storeCredentials('your-org-id', 'your-api-key');

// Retrieve credentials
const config = CredentialManager.getCredentials();

// Validate format
const isValid = CredentialManager.hasValidCredentials();
```

## Rate Limiting ve Güvenilir Tarama

Full scan, target başına build saymak yerine organizasyonun **tüm build listesini** sayfalı çeker
(`/orgs/{org}/builds?per_page=100`): 3600 build için ~40 istek, 650 yerine. Unity'nin abuse detection'ı
`/builds` uç noktasına ~170 istekten sonra saatlerce ban verdiği için bu tek sürdürülebilir yol.

Unity Cloud Build API, kısa sürede çok istek gelince `403` + "abuse detection" mesajıyla geçici blok uygular. Tarama bunu şöyle yönetir:

- Unity'nin belgelenmiş limiti 100 istek/dk ama yanıt başlıkları gerçek limiti **60/dk** gösteriyor; biz varsayılan **30/dk** ile yarısında kalırız (`UNITY_API_MAX_PER_MINUTE`), istekler arası en az 1,5 sn (`UNITY_API_MIN_INTERVAL_MS`)
- `X-RateLimit-Remaining` 10'un altına inince `X-RateLimit-Reset`'e kadar beklenir; 429'daki "retry in N seconds" ve `Retry-After` birebir uygulanır
- Abuse banı alındığında 2 dk'dan başlayıp 1 saate çıkan beklemelerle aynı istek tekrar denenir; bu sırada başka istek atılmaz (scan ve artifact silme ortak pencereyi paylaşır). Ban saatlerce sürebildiği ve her istek onu uzattığı için seyrek yoklamak şart
- Artifact silmede de beklemeler logda gösterilir; limit tükenirse işlem durur, target atlanmaz

## Job Sistemi

Full scan ve artifact silme **job** olarak çalışır (`docs/job-system.md`):

- İşler sıraya alınır ve tek tek çalışır; dashboard'daki **Jobs** panelinde durum, ilerleme çubuğu, aşama ("Rate limit: 5 dk bekleniyor") ve geri sayım görünür
- Sekmeyi kapatsanız da iş sürer; servis kapanıp açılırsa iş "Yarım kaldı" olur ve dashboard açıldığında **kaldığı yerden** otomatik devam eder (tamamlanmış projeler/target'lar tekrar işlenmez)
- Eksikli biten full scan için "Eksikleri tekrar dene" yalnızca tamamlanamayan projeleri tarar
- Tabloda birden çok proje seçip **toplu artifact silme** başlatılabilir; projeler sırayla işlenir, yarım kalırsa tamamlananlar atlanır
- Tablodaki **Artifact'li** sütunu artifact'i hâlâ duran build sayısıdır (silme sonrası sıfıra iner); Build sütunu kayıt sayısıdır ve silmeyle değişmez
- API key veritabanına yazılmaz; resume için tarayıcıdaki kayıtlı key kullanılır
- Tamamlanamayan projeler scan sonunda 60 sn soğumadan sonra yeniden denenir (3 geçiş)
- Yarım kalan projeler cache'e alınmaz; bir sonraki scan'de otomatik olarak tekrar taranır
- Scan sonunda hâlâ eksik proje varsa dashboard'da kırmızı kutuda listelenir

## Known Issues

1. **Mantine UI**: UI components not yet implemented - basic HTML structure in place
2. **Unity V1 API**: `build-api.cloud.unity3d.com` V1 API'si Unity tarafından emekliye ayrılıyor; Service Account (V2/V3) desteği henüz yok

## Next Steps

1. **Implement Mantine UI components** for the dashboard interface
2. **Migrate to Build Automation V2/V3 API** (service account auth)
3. **Implement data visualization** for build statistics
4. **Add export functionality** for scan results

## Contributing

This project follows a documentation-first approach. All architectural decisions and module relationships are documented in the `docs/` directory. Please refer to these documents before making changes.

## License

[Add your license here]
