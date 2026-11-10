// Unity Cloud Build API Types
export interface UnityProject {
  projectid: string;
  projectId?: string;
  id?: string;
  name: string;
  projectName?: string;
  orgid?: string;
  organizationId?: string;
  created?: string;
  cachedIcon?: string;
  description?: string;
}

export interface UnityBuildTarget {
  buildtargetid: string;
  buildTargetId?: string;
  name: string;
  platform?: string;
  enabled?: boolean;
  settings?: Record<string, any>;
}

/** /orgs/{org}/builds listesindeki build kaydı (yalnızca kullandığımız alanlar) */
export interface UnityBuild {
  build?: number;
  buildtargetid?: string;
  buildTargetName?: string;
  projectId?: string;
  projectGuid?: string;
  projectName?: string;
  platform?: string;
  buildStatus?: string;
  deleted?: boolean;
  deletedArtifacts?: boolean;
  created?: string;
}

/** Org genelindeki build listesinden türetilen, proje bazında toplanmış sayımlar */
export interface OrgBuildAggregate {
  /** projectGuid veya projectId → target'lar */
  projects: Map<string, {
    projectName?: string;
    targets: Map<string, { name: string; platform?: string; count: number; withArtifacts: number }>;
    totalBuilds: number;
  }>;
  totalBuilds: number;
  pages: number;
}

// Local Database Types
export interface ProjectData {
  id: string;
  name: string;
  organizationId: string;
  description?: string;
  lastScannedAt?: Date;
  platforms?: string[];
  totalBuilds?: number;
  /** Artifact'i hâlâ duran build sayısı */
  artifactBuilds?: number;
}

export interface BuildTargetData {
  id: string;
  name: string;
  platform?: string;
  projectId: string;
  enabled: boolean;
}

export interface ScanResult {
  id: string;
  projectId: string;
  status: 'completed' | 'failed' | 'partial';
  totalBuilds: number;
  artifactBuilds?: number;
  totalTargets: number;
  scannedTargets: number;
  errorMessage?: string;
  startedAt: Date;
  completedAt?: Date;
  durationMs?: number;
}

// Configuration Types
export interface AppConfig {
  orgId: string;
  apiKey: string;
  limitProjects?: number;
  limitTargets?: number;
}

// Logging Types
export type LogLevel = 'info' | 'warning' | 'error' | 'success';

export interface LogEntry {
  id: number;
  level: LogLevel;
  message: string;
  details?: string;
  timestamp: Date;
  source?: string;
}

// Scanning Types
export interface ScanOptions {
  credentials?: AppConfig; // Server-side scan için credentials
  limitProjects?: number;
  limitTargets?: number;
  parallelRequests?: number;
  /** Bu süreden eski cache kayıtları yeniden taranır (ms). Varsayılan: DEFAULT_CACHE_MAX_AGE_MS (1 hafta) */
  cacheMaxAgeMs?: number;
  /** Tamamlanamayan projeler için toplam geçiş sayısı (varsayılan 3) */
  maxPasses?: number;
  /** Verilirse API'den proje listesi çekilmez, bu liste taranır (job resume) */
  projects?: Array<{ projectId: string; projectName: string; description?: string }>;
}

export interface ScanProgress {
  currentProject: number;
  totalProjects: number;
  currentProjectName: string;
  currentTarget: number;
  totalTargets: number;
  isScanning: boolean;
  canCancel: boolean;
  /** Kaçıncı geçiş (1 = ilk tarama, 2+ = başarısızların yeniden denenmesi) */
  pass?: number;
  maxPasses?: number;
  /** Henüz tamamlanamamış proje sayısı */
  pendingProjects?: number;
}

/** Tek bir build target'ın tarama sonucu */
export interface TargetScanData {
  id: string;
  name: string;
  platform?: string;
  enabled: boolean;
  /** null ise sayım alınamadı (error dolu olur) */
  buildCount: number | null;
  /** artifact'i duran build sayısı (bilinmiyorsa null) */
  artifactCount?: number | null;
  error?: string;
}

/** Tek bir projenin API'den alınan tarama verisi (persist edilmeden önce) */
export interface ProjectScanData {
  projectId: string;
  totalBuilds: number;
  /** artifact'i duran build sayısı */
  artifactBuilds: number;
  targetCount: number;
  scannedTargets: number;
  targets: TargetScanData[];
  errors: string[];
}

export interface ProjectScanResult {
  projectId: string;
  projectName: string;
  totalBuilds: number;
  artifactBuilds: number;
  targetCount: number;
  scannedTargets: number;
  status: 'completed' | 'failed' | 'partial';
  errors: string[];
  isFromCache: boolean; // Cache'den mi geldi?
  cachedAt?: Date; // Cache tarihi
}

export interface ScanSummary {
  totalProjects: number;
  completedProjects: number;
  totalBuilds: number;
  artifactBuilds: number;
  totalTargets: number;
  totalErrors: number;
  cachedProjects: number; // Cache'den gelen proje sayısı
  freshProjects: number; // API'den yeni taranan proje sayısı
  /** Tüm geçişlere rağmen tamamlanamayan projeler */
  failedProjects: Array<{ projectId: string; projectName: string; status: 'failed' | 'partial'; errors: string[] }>;
  /** Kaç geçiş yapıldı */
  passes: number;
  /** Kullanıcı iptal ettiyse true */
  cancelled: boolean;
}

// API Response Types
export interface ApiError {
  status: number;
  message: string;
  details?: string;
}

export interface ContentRangeInfo {
  start: number;
  end: number;
  total: number;
}
