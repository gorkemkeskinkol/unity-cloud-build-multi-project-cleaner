'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useLog } from '@/contexts/LogContext';
import { AppConfig } from '@/types';
import { JobRecord, JobType, JobParams, JobLogEvent, isActive } from '@/types/jobs';

/**
 * Job listesini tutar, /api/jobs/events SSE akışına bağlanır (log + job güncellemeleri),
 * yarım kalmış (interrupted) işleri sayfa açılınca localStorage'daki credentials ile
 * otomatik sürdürür.
 */
export function useJobs(config: AppConfig, onJobFinished?: (job: JobRecord) => void) {
  const [jobs, setJobs] = useState<JobRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isConnected, setIsConnected] = useState(false);
  const { addLog } = useLog();
  const autoResumed = useRef<Set<string>>(new Set());
  const finishedRef = useRef(onJobFinished);
  finishedRef.current = onJobFinished;
  const knownStatus = useRef<Map<string, string>>(new Map());

  const credentials = { orgId: config.orgId, apiKey: config.apiKey };

  const refresh = useCallback(async () => {
    try {
      const response = await fetch('/api/jobs');
      if (response.ok) {
        const data = await response.json();
        setJobs(data.jobs);
        for (const job of data.jobs as JobRecord[]) {
          knownStatus.current.set(job.id, job.status);
        }
      }
    } catch (error) {
      console.error('Jobs yüklenemedi:', error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const resumeJob = useCallback(async (jobId: string) => {
    try {
      const response = await fetch(`/api/jobs/${jobId}/resume`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ credentials })
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        // 409: başka bir sekme zaten sürdürmüş; hata değil
        addLog(response.status === 409 ? 'info' : 'error', `Resume: ${data.error || response.status}`, 'Jobs');
      }
    } catch (error) {
      addLog('error', `Resume hatası: ${error instanceof Error ? error.message : String(error)}`, 'Jobs');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.orgId, config.apiKey]);

  const cancelJob = useCallback(async (jobId: string) => {
    try {
      const response = await fetch(`/api/jobs/${jobId}/cancel`, { method: 'POST' });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        addLog('warning', `İptal edilemedi: ${data.error || response.status}`, 'Jobs');
      }
    } catch (error) {
      addLog('error', `İptal hatası: ${error instanceof Error ? error.message : String(error)}`, 'Jobs');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const createJob = useCallback(async (type: JobType, params: Partial<JobParams>): Promise<JobRecord | null> => {
    try {
      const response = await fetch('/api/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, params, credentials })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        addLog('error', `İş oluşturulamadı: ${data.error || response.status}`, 'Jobs');
        return null;
      }
      return data.job as JobRecord;
    } catch (error) {
      addLog('error', `İş oluşturma hatası: ${error instanceof Error ? error.message : String(error)}`, 'Jobs');
      return null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.orgId, config.apiKey]);

  // İlk yükleme + yarım kalan işleri otomatik sürdür
  useEffect(() => {
    let cancelled = false;
    (async () => {
      await refresh();
      if (cancelled) return;
      const response = await fetch('/api/jobs').then(r => r.ok ? r.json() : null).catch(() => null);
      const interrupted = (response?.jobs as JobRecord[] | undefined)?.filter(j => j.status === 'interrupted') ?? [];
      for (const job of interrupted) {
        if (autoResumed.current.has(job.id)) continue;
        autoResumed.current.add(job.id);
        addLog('warning', `Yarım kalmış iş bulundu, kaldığı yerden devam ettiriliyor: ${job.title}`, 'Jobs');
        await resumeJob(job.id);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // SSE: loglar ve job güncellemeleri
  useEffect(() => {
    const source = new EventSource('/api/jobs/events');

    source.onopen = () => setIsConnected(true);
    source.onerror = () => setIsConnected(false); // EventSource kendi yeniden bağlanır

    source.addEventListener('backlog', (e) => {
      try {
        const backlog = JSON.parse((e as MessageEvent).data) as JobLogEvent[];
        // Sadece son 50 logu göster; geri kalanı gürültü
        for (const log of backlog.slice(-50)) {
          addLog(log.level, log.message, log.source);
        }
      } catch { /* yoksay */ }
    });

    source.addEventListener('log', (e) => {
      try {
        const log = JSON.parse((e as MessageEvent).data) as JobLogEvent;
        addLog(log.level, log.message, log.source);
      } catch { /* yoksay */ }
    });

    source.addEventListener('job', (e) => {
      try {
        const { job } = JSON.parse((e as MessageEvent).data) as { job: JobRecord };
        setJobs(prev => {
          const idx = prev.findIndex(j => j.id === job.id);
          if (idx === -1) return [job, ...prev];
          const next = [...prev];
          next[idx] = job;
          return next;
        });
        const previous = knownStatus.current.get(job.id);
        knownStatus.current.set(job.id, job.status);
        if (previous !== job.status && !isActive(job) && previous !== undefined) {
          finishedRef.current?.(job);
        }
      } catch { /* yoksay */ }
    });

    return () => source.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { jobs, isLoading, isConnected, refresh, createJob, cancelJob, resumeJob };
}
