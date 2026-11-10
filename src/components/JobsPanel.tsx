'use client';

import { useEffect, useState } from 'react';
import { Badge, Button, Card, Group, Indicator, Progress, Stack, Text, Title, Tooltip } from '@mantine/core';
import { IconPlayerStop, IconRotateClockwise } from '@tabler/icons-react';
import { JobRecord, isActive, isResumable } from '@/types/jobs';

interface Props {
  jobs: JobRecord[];
  isLoading: boolean;
  isConnected: boolean;
  onCancel: (jobId: string) => void;
  onResume: (jobId: string) => void;
}

const STATUS: Record<JobRecord['status'], { color: string; label: string }> = {
  queued:      { color: 'gray',   label: 'Sırada' },
  running:     { color: 'blue',   label: 'Çalışıyor' },
  interrupted: { color: 'yellow', label: 'Yarım kaldı' },
  completed:   { color: 'green',  label: 'Tamamlandı' },
  failed:      { color: 'red',    label: 'Hata' },
  cancelled:   { color: 'gray',   label: 'İptal' }
};

function formatTime(iso: string | null): string {
  if (!iso) return '-';
  return new Date(iso).toLocaleString('tr-TR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function elapsed(job: JobRecord, now: number): string {
  if (!job.startedAt) return '';
  const start = new Date(job.startedAt).getTime();
  const end = job.finishedAt ? new Date(job.finishedAt).getTime() : now;
  const s = Math.max(0, Math.round((end - start) / 1000));
  if (s < 60) return `${s} sn`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} dk ${s % 60} sn`;
  return `${Math.floor(m / 60)} sa ${m % 60} dk`;
}

function remaining(until: string, now: number): string | null {
  const r = Math.max(0, Math.round((new Date(until).getTime() - now) / 1000));
  if (r === 0) return null;
  return r >= 120 ? `${Math.ceil(r / 60)} dk` : `${r} sn`;
}

/** Saniyede bir yeniden çizim: geçen süre ve geri sayım için */
function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [active]);
  return now;
}

function JobCard({ job, now, onCancel, onResume }: { job: JobRecord; now: number; onCancel: Props['onCancel']; onResume: Props['onResume'] }) {
  const status = STATUS[job.status];
  const p = job.progress;
  const active = isActive(job);
  const pct = p && p.total > 0 ? Math.round((p.done / p.total) * 100) : 0;
  const countdown = active && p?.waitingUntil ? remaining(p.waitingUntil, now) : null;
  const barColor = job.status === 'failed' ? 'red' : (p?.failed ?? 0) > 0 ? 'yellow' : job.status === 'completed' ? 'green' : 'blue';

  return (
    <Card p="sm">
      <Stack gap={6}>
        <Group justify="space-between" wrap="nowrap">
          <Group gap="xs" wrap="nowrap" style={{ minWidth: 0 }}>
            <Badge color={status.color} variant={active ? 'filled' : 'light'} style={{ flexShrink: 0 }}>{status.label}</Badge>
            <Text fw={600} truncate>{job.title}</Text>
            <Text size="xs" c="dimmed" style={{ whiteSpace: 'nowrap' }}>
              {formatTime(job.createdAt)}{job.startedAt ? ` · ${elapsed(job, now)}` : ''}
            </Text>
          </Group>
          <Group gap={6} wrap="nowrap">
            {active && (
              <Button size="compact-xs" color="red" variant="light" leftSection={<IconPlayerStop size={12} />} onClick={() => onCancel(job.id)}>
                İptal
              </Button>
            )}
            {isResumable(job) && (
              <Button size="compact-xs" variant="light" leftSection={<IconRotateClockwise size={12} />} onClick={() => onResume(job.id)}>
                {job.status === 'completed' ? 'Eksikleri tekrar dene' : 'Devam et'}
              </Button>
            )}
          </Group>
        </Group>

        {p && p.total > 0 && (
          <>
            <Progress value={pct} color={barColor} size="sm" animated={active} />
            <Group justify="space-between" gap="xs">
              <Text size="xs" c="dimmed">
                {p.done}/{p.total} tamamlandı{p.failed > 0 ? `, ${p.failed} eksik` : ''}
                {p.pass && p.pass > 1 ? ` · geçiş ${p.pass}/${p.maxPasses}` : ''}
              </Text>
              <Text size="xs" c={countdown ? 'yellow' : 'dimmed'} ta="right">
                {p.phase}{p.currentName && active ? `: ${p.currentName}` : ''}{countdown ? ` · ${countdown} kaldı` : ''}
              </Text>
            </Group>
          </>
        )}
        {p && p.total === 0 && active && (
          <Text size="xs" c={countdown ? 'yellow' : 'dimmed'}>
            {p.phase}{countdown ? ` · ${countdown} kaldı` : ''}
          </Text>
        )}
        {job.error && <Text size="xs" c="red">{job.error}</Text>}
      </Stack>
    </Card>
  );
}

export function JobsPanel({ jobs, isLoading, isConnected, onCancel, onResume }: Props) {
  const [showAll, setShowAll] = useState(false);
  const anyActive = jobs.some(isActive);
  const now = useNow(anyActive);
  const visible = showAll ? jobs : jobs.filter((j, i) => isActive(j) || j.status === 'interrupted' || i < 4);

  return (
    <Stack gap="xs">
      <Group justify="space-between">
        <Group gap="sm">
          <Title order={5}>İşler</Title>
          <Tooltip label={isConnected ? 'Canlı güncelleme bağlı' : 'Bağlantı koptu, yeniden bağlanıyor'}>
            <Indicator color={isConnected ? 'green' : 'red'} processing={!isConnected} size={8} position="middle-start" offset={-6}>
              <Text size="xs" c="dimmed" ml={8}>{isConnected ? 'canlı' : 'bağlantı yok'}</Text>
            </Indicator>
          </Tooltip>
        </Group>
        {(jobs.length > visible.length || showAll) && (
          <Button size="compact-xs" variant="subtle" color="gray" onClick={() => setShowAll(s => !s)}>
            {showAll ? 'Daha az göster' : `Tümünü göster (${jobs.length})`}
          </Button>
        )}
      </Group>

      {isLoading ? (
        <Text size="sm" c="dimmed">Yükleniyor...</Text>
      ) : visible.length === 0 ? (
        <Text size="sm" c="dimmed" fs="italic">
          Henüz iş yok. İşler servis kapanıp açılsa da kaldığı yerden devam eder.
        </Text>
      ) : (
        visible.map(job => <JobCard key={job.id} job={job} now={now} onCancel={onCancel} onResume={onResume} />)
      )}
    </Stack>
  );
}
