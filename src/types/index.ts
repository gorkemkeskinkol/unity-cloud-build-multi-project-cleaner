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

// Local Database Types
export interface ProjectData {
  id: string;
  name: string;
  organizationId: string;
  description?: string;
  lastScannedAt?: Date;
  platforms?: string[];
  totalBuilds?: number;
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
}

export interface ScanProgress {
  currentProject: number;
  totalProjects: number;
  currentProjectName: string;
  currentTarget: number;
  totalTargets: number;
  isScanning: boolean;
  canCancel: boolean;
}

export interface ProjectScanResult {
  projectId: string;
  projectName: string;
  totalBuilds: number;
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
  totalTargets: number;
  totalErrors: number;
  cachedProjects: number; // Cache'den gelen proje sayısı
  freshProjects: number; // API'den yeni taranan proje sayısı
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
