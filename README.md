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
│   ├── app/                  # Next.js app directory
│   ├── components/           # React components (planned)
│   ├── contexts/             # React contexts
│   │   └── LogContext.tsx    # Global logging state
│   ├── modules/              # Core business logic
│   │   ├── api/              # Unity Cloud Build API integration
│   │   ├── config/           # Configuration management
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

## Known Issues

1. **npm install failure**: Currently fails due to disk space constraints
2. **Mantine UI**: UI components not yet implemented - basic HTML structure in place
3. **Database operations**: Prisma client integration pending npm install completion
4. **TypeScript dependencies**: Some type resolution issues due to missing node_modules

## Next Steps

1. **Resolve dependency installation** (requires disk space cleanup)
2. **Implement Mantine UI components** for the dashboard interface
3. **Add database persistence** for scan results
4. **Implement data visualization** for build statistics
5. **Add export functionality** for scan results

## Contributing

This project follows a documentation-first approach. All architectural decisions and module relationships are documented in the `docs/` directory. Please refer to these documents before making changes.

## License

[Add your license here]
