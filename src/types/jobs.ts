// Job sistemi tipleri (server ve client ortak)

export type JobType = 'full_scan' | 'delete_builds' | 'delete_builds_bulk';

export type JobStatus =
  | 'queued'       // sırada, henüz başlamadı
  | 'running'      // şu an çalışıyor
  | 'interrupted'  // servis kapandı/çöktü; resume ile kaldığı yerden devam eder
  | 'completed'    // bitti (bazı item'lar failed olabilir, result'a bak)
  | 'failed'       // ölümcül hata (rate limit tükendi, key geçersiz)
  | 'cancelled';   // kullanıcı iptal etti

export type JobItemStatus = 'pending' | 'running' | 'completed' | 'partial' | 'failed' | 'cancelled';

export interface JobParams {
  orgId: string;
  limitProjects?: number;
  limitTargets?: number;
  /** delete_builds için */
  projectId?: string;
  projectName?: string;
  /** delete_builds_bulk için */
  projects?: Array<{ id: string; name: string }>;
  updateCache?: boolean;
}

export interface JobProgress {
  total: number;
  done: number;
  failed: number;
  /** Şu an işlenen proje/target adı */
  currentName?: string;
  pass?: number;
  maxPasses?: number;
  /** Kullanıcıya gösterilecek kısa durum: "Taranıyor", "Rate limit: 60 sn bekleniyor", "Cache yenileniyor" */
  phase?: string;
  /** Bekleme bitiş zamanı (ISO) - UI geri sayım gösterebilir */
  waitingUntil?: string | null;
}

export interface JobRecord {
  id: string;
  type: JobType;
  status: JobStatus;
  title: string;
  params: JobParams;
  progress: JobProgress | null;
  result: Record<string, unknown> | null;
  error: string | null;
  createdAt: string;
  startedAt: string | null;
  updatedAt: string;
  finishedAt: string | null;
}

export interface JobItemRecord {
  id: string;
  jobId: string;
  kind: 'project' | 'target';
  refId: string;
  name: string;
  status: JobItemStatus;
  attempts: number;
  error: string | null;
  result: Record<string, unknown> | null;
  updatedAt: string;
}

export interface JobLogEvent {
  kind: 'log';
  jobId?: string;
  level: 'info' | 'warning' | 'error' | 'success';
  message: string;
  source?: string;
  timestamp: string;
}

export interface JobUpdateEvent {
  kind: 'job';
  job: JobRecord;
}

export type JobEvent = JobLogEvent | JobUpdateEvent;

/** Job yeniden başlatılabilir mi? (interrupted/failed/cancelled, ya da tamamlanmış ama eksik item'ı var) */
export function isResumable(job: JobRecord): boolean {
  if (job.status === 'interrupted' || job.status === 'failed' || job.status === 'cancelled') return true;
  if (job.status === 'completed' && job.progress && job.progress.failed > 0) return true;
  return false;
}

export function isActive(job: JobRecord): boolean {
  return job.status === 'queued' || job.status === 'running';
}
