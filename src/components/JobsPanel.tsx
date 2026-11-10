'use client';

import { useEffect, useState } from 'react';
import { JobRecord, isActive, isResumable } from '@/types/jobs';

interface Props {
  jobs: JobRecord[];
  isLoading: boolean;
  isConnected: boolean;
  onCancel: (jobId: string) => void;
  onResume: (jobId: string) => void;
}

const STATUS_STYLE: Record<JobRecord['status'], { bg: string; fg: string; label: string }> = {
  queued:      { bg: '#e2e3e5', fg: '#383d41', label: 'Sırada' },
  running:     { bg: '#cce5ff', fg: '#004085', label: 'Çalışıyor' },
  interrupted: { bg: '#fff3cd', fg: '#856404', label: 'Yarım kaldı' },
  completed:   { bg: '#d4edda', fg: '#155724', label: 'Tamamlandı' },
  failed:      { bg: '#f8d7da', fg: '#721c24', label: 'Hata' },
  cancelled:   { bg: '#e2e3e5', fg: '#383d41', label: 'İptal' }
};

function formatTime(iso: string | null): string {
  if (!iso) return '-';
  return new Date(iso).toLocaleString('tr-TR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function elapsed(job: JobRecord): string {
  const start = job.startedAt ? new Date(job.startedAt).getTime() : null;
  if (!start) return '';
  const end = job.finishedAt ? new Date(job.finishedAt).getTime() : Date.now();
  const seconds = Math.max(0, Math.round((end - start) / 1000));
  if (seconds < 60) return `${seconds} sn`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} dk ${seconds % 60} sn`;
  return `${Math.floor(minutes / 60)} sa ${minutes % 60} dk`;
}

/** Bekleme bitişine geri sayım */
function Countdown({ until }: { until: string }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => tick(t => t + 1), 1000);
    return () => clearInterval(id);
  }, []);
  const remaining = Math.max(0, Math.round((new Date(until).getTime() - Date.now()) / 1000));
  if (remaining === 0) return null;
  return <span style={{ color: '#856404' }}> · {remaining >= 120 ? `${Math.ceil(remaining / 60)} dk` : `${remaining} sn`} kaldı</span>;
}

export function JobsPanel({ jobs, isLoading, isConnected, onCancel, onResume }: Props) {
  const [showAll, setShowAll] = useState(false);
  const visible = showAll ? jobs : jobs.filter((j, i) => isActive(j) || j.status === 'interrupted' || i < 5);

  return (
    <div style={{ backgroundColor: '#f8f9fa', padding: '15px', borderRadius: '4px', marginBottom: '20px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
        <h3 style={{ margin: 0 }}>
          Jobs
          <span style={{ marginLeft: '10px', fontSize: '12px', color: isConnected ? '#28a745' : '#dc3545' }}>
            ● {isConnected ? 'canlı' : 'bağlantı yok, yeniden bağlanıyor'}
          </span>
        </h3>
        {jobs.length > visible.length || showAll ? (
          <button onClick={() => setShowAll(s => !s)} style={{ padding: '4px 8px', fontSize: '12px', border: '1px solid #ccc', borderRadius: '3px', cursor: 'pointer', background: 'white' }}>
            {showAll ? 'Sadece son işler' : `Tümünü göster (${jobs.length})`}
          </button>
        ) : null}
      </div>

      {isLoading ? (
        <p style={{ color: '#666', margin: 0 }}>Yükleniyor...</p>
      ) : visible.length === 0 ? (
        <p style={{ color: '#666', margin: 0, fontStyle: 'italic' }}>Henüz iş yok. &quot;Start Full Scan&quot; ile başlayın; işler servis kapanıp açılsa da kaldığı yerden devam eder.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {visible.map(job => {
            const style = STATUS_STYLE[job.status];
            const p = job.progress;
            const pct = p && p.total > 0 ? Math.round((p.done / p.total) * 100) : 0;
            const waiting = p?.waitingUntil && isActive(job);
            return (
              <div key={job.id} style={{ backgroundColor: 'white', border: '1px solid #ddd', borderRadius: '4px', padding: '10px 12px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
                    <span style={{ padding: '2px 8px', borderRadius: '3px', fontSize: '12px', fontWeight: 'bold', backgroundColor: style.bg, color: style.fg, whiteSpace: 'nowrap' }}>
                      {style.label}
                    </span>
                    <strong style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{job.title}</strong>
                    <span style={{ fontSize: '12px', color: '#666', whiteSpace: 'nowrap' }}>
                      {formatTime(job.createdAt)}{elapsed(job) ? ` · ${elapsed(job)}` : ''}
                    </span>
                  </div>
                  <div style={{ display: 'flex', gap: '6px' }}>
                    {isActive(job) && (
                      <button onClick={() => onCancel(job.id)} style={{ padding: '4px 10px', fontSize: '12px', backgroundColor: '#dc3545', color: 'white', border: 'none', borderRadius: '3px', cursor: 'pointer' }}>
                        İptal
                      </button>
                    )}
                    {isResumable(job) && (
                      <button onClick={() => onResume(job.id)} style={{ padding: '4px 10px', fontSize: '12px', backgroundColor: '#007bff', color: 'white', border: 'none', borderRadius: '3px', cursor: 'pointer' }}>
                        {job.status === 'completed' ? 'Eksikleri tekrar dene' : 'Kaldığı yerden devam'}
                      </button>
                    )}
                  </div>
                </div>

                {p && p.total > 0 && (
                  <div style={{ marginTop: '8px' }}>
                    <div style={{ height: '8px', backgroundColor: '#e9ecef', borderRadius: '4px', overflow: 'hidden' }}>
                      <div style={{ width: `${pct}%`, height: '100%', backgroundColor: job.status === 'failed' ? '#dc3545' : p.failed > 0 ? '#ffc107' : '#28a745', transition: 'width 0.3s' }} />
                    </div>
                    <div style={{ fontSize: '12px', color: '#555', marginTop: '4px', display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: '6px' }}>
                      <span>
                        {p.done}/{p.total} tamamlandı{p.failed > 0 ? `, ${p.failed} eksik` : ''}
                        {p.pass && p.pass > 1 ? ` · geçiş ${p.pass}/${p.maxPasses}` : ''}
                      </span>
                      <span>
                        {p.phase}{p.currentName && isActive(job) ? `: ${p.currentName}` : ''}
                        {waiting ? <Countdown until={p.waitingUntil!} /> : null}
                      </span>
                    </div>
                  </div>
                )}
                {p && p.total === 0 && isActive(job) && (
                  <div style={{ fontSize: '12px', color: '#555', marginTop: '6px' }}>
                    {p.phase}{waiting ? <Countdown until={p.waitingUntil!} /> : null}
                  </div>
                )}

                {job.error && (
                  <div style={{ fontSize: '12px', color: '#721c24', marginTop: '6px' }}>{job.error}</div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
