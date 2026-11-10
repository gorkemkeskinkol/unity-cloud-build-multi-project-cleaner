import { JobEvent, JobLogEvent } from '@/types/jobs';

type Listener = (event: JobEvent) => void;

/** Geç bağlanan istemcilere gösterilecek son log sayısı */
const LOG_BACKLOG_SIZE = 300;

/**
 * Süreç içi olay yayını. Runner buraya log ve job güncellemesi basar,
 * /api/jobs/events SSE rotası dinleyip tarayıcıya iletir.
 * globalThis'te tutulur: dev modda modül yeniden yüklense de aboneler kaybolmaz.
 */
class JobEventBus {
  private listeners = new Set<Listener>();
  private backlog: JobLogEvent[] = [];

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(event: JobEvent): void {
    if (event.kind === 'log') {
      this.backlog.push(event);
      if (this.backlog.length > LOG_BACKLOG_SIZE) {
        this.backlog.splice(0, this.backlog.length - LOG_BACKLOG_SIZE);
      }
    }
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (error) {
        console.error('[JobEventBus] listener error:', error);
      }
    }
  }

  log(level: JobLogEvent['level'], message: string, source = 'Jobs', jobId?: string): void {
    this.emit({ kind: 'log', jobId, level, message, source, timestamp: new Date().toISOString() });
  }

  getBacklog(): JobLogEvent[] {
    return [...this.backlog];
  }
}

const KEY = '__ucb_job_event_bus__';
const g = globalThis as unknown as Record<string, JobEventBus | undefined>;

export function getJobEventBus(): JobEventBus {
  if (!g[KEY]) {
    g[KEY] = new JobEventBus();
  }
  return g[KEY];
}
