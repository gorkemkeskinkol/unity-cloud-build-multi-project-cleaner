'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  Alert, AppShell, Badge, Button, Code, Grid, Group, List, Modal, NumberInput, Paper, ScrollArea, Stack, Text, Title, Tooltip
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconAlertTriangle, IconLogout, IconPlayerPlay, IconPlayerStop } from '@tabler/icons-react';
import { CredentialManager } from '@/modules/config/credential-manager';
import { useLog } from '@/contexts/LogContext';
import { useJobs } from '@/hooks/useJobs';
import { AppConfig } from '@/types';
import { JobRecord, isActive } from '@/types/jobs';
import { JobsPanel } from '@/components/JobsPanel';
import { LogPanel } from '@/components/LogPanel';
import { ProjectsTable, CachedProject } from '@/components/ProjectsTable';
import { ScanSummary, FullScanResult } from '@/components/ScanSummary';

const HEADER_HEIGHT = 56;

export function Dashboard({ config }: { config: AppConfig }) {
  const { addLog } = useLog();
  const [limitProjects, setLimitProjects] = useState<number | ''>('');
  const [projects, setProjects] = useState<CachedProject[]>([]);
  const [isLoadingProjects, setIsLoadingProjects] = useState(true);
  const [isClearingCache, setIsClearingCache] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<CachedProject | null>(null);
  const [bulkDeleteTargets, setBulkDeleteTargets] = useState<CachedProject[] | null>(null);
  const [isCreatingDelete, setIsCreatingDelete] = useState(false);

  const loadProjects = useCallback(async () => {
    try {
      setIsLoadingProjects(true);
      const response = await fetch('/api/cache/projects');
      if (response.ok) setProjects(await response.json());
    } catch (error) {
      console.error('Projeler yüklenemedi:', error);
    } finally {
      setIsLoadingProjects(false);
    }
  }, []);

  const onJobFinished = useCallback((job: JobRecord) => {
    void loadProjects();
    const failed = job.progress?.failed ?? 0;
    notifications.show({
      title: job.status === 'completed' ? (failed > 0 ? 'İş bitti, eksikler var' : 'İş tamamlandı') : job.status === 'cancelled' ? 'İş iptal edildi' : 'İş durdu',
      message: job.title + (failed > 0 ? ` · ${failed} eksik` : '') + (job.error ? ` · ${job.error}` : ''),
      color: job.status === 'completed' ? (failed > 0 ? 'yellow' : 'green') : job.status === 'cancelled' ? 'gray' : 'red',
      autoClose: 8000
    });
  }, [loadProjects]);

  const { jobs, isLoading: isLoadingJobs, isConnected, createJob, cancelJob, resumeJob } = useJobs(config, onJobFinished);

  useEffect(() => { void loadProjects(); }, [loadProjects]);

  const activeScan = jobs.find(j => j.type === 'full_scan' && isActive(j));
  const lastScan = jobs.find(j => j.type === 'full_scan' && j.status === 'completed');
  const lastScanResult = lastScan?.result as FullScanResult | undefined;

  const startScan = async () => {
    if (activeScan) return;
    const job = await createJob('full_scan', {
      limitProjects: typeof limitProjects === 'number' && limitProjects > 0 ? limitProjects : undefined,
      limitTargets: config.limitTargets
    });
    if (job) {
      addLog('success', `Full scan sıraya alındı. Sekmeyi kapatsanız da iş sürer.`, 'Dashboard');
    }
  };

  const clearCache = async (projectIds: string[]) => {
    if (projectIds.length === 0) return;
    try {
      setIsClearingCache(true);
      const response = projectIds.length === 1
        ? await fetch(`/api/cache/${projectIds[0]}`, { method: 'DELETE' })
        : await fetch('/api/cache/bulk', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projectIds }) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      addLog('success', `${projectIds.length} projenin cache'i temizlendi; bir sonraki full scan'de yeniden taranacak`, 'Cache');
      await loadProjects();
    } catch (error) {
      addLog('error', `Cache temizleme hatası: ${error instanceof Error ? error.message : String(error)}`, 'Cache');
    } finally {
      setIsClearingCache(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    try {
      setIsCreatingDelete(true);
      const job = await createJob('delete_builds', { projectId: deleteTarget.id, projectName: deleteTarget.name, updateCache: true });
      if (job) addLog('success', `"${deleteTarget.name}" için artifact silme işi sıraya alındı`, 'DeleteBuilds');
    } finally {
      setIsCreatingDelete(false);
      setDeleteTarget(null);
    }
  };

  const confirmBulkDelete = async () => {
    if (!bulkDeleteTargets || bulkDeleteTargets.length === 0) return;
    try {
      setIsCreatingDelete(true);
      const job = await createJob('delete_builds_bulk', {
        projects: bulkDeleteTargets.map(p => ({ id: p.id, name: p.name })),
        updateCache: true
      });
      if (job) addLog('success', `${bulkDeleteTargets.length} proje için toplu artifact silme işi sıraya alındı`, 'DeleteBuilds');
    } finally {
      setIsCreatingDelete(false);
      setBulkDeleteTargets(null);
    }
  };

  const resetCredentials = () => {
    CredentialManager.clearCredentials();
    window.location.reload();
  };

  return (
    <AppShell header={{ height: HEADER_HEIGHT }} padding="md">
      <AppShell.Header>
        <Group h="100%" px="md" justify="space-between">
          <Group gap="sm">
            <Title order={4}>Unity Cloud Build Cleaner</Title>
            <Badge variant="light" color="gray" visibleFrom="sm">org {config.orgId}</Badge>
            <Tooltip label="Unity API gerçek limiti 60 istek/dk; uygulama 30/dk ile çalışır">
              <Badge variant="outline" color="gray" visibleFrom="md">30 istek/dk</Badge>
            </Tooltip>
          </Group>
          <Button variant="subtle" color="gray" size="xs" leftSection={<IconLogout size={14} />} onClick={resetCredentials}>
            Kimlik bilgilerini sıfırla
          </Button>
        </Group>
      </AppShell.Header>

      <AppShell.Main>
        <Grid gutter="md">
          <Grid.Col span={{ base: 12, lg: 8 }}>
            <Stack gap="md">
              <Paper p="md">
                <Group justify="space-between" align="flex-end" wrap="wrap">
                  <Group align="flex-end" gap="sm">
                    <NumberInput
                      label="Proje limiti"
                      description="Boş: tüm projeler"
                      placeholder="hepsi"
                      min={1}
                      w={160}
                      value={limitProjects}
                      onChange={(v) => setLimitProjects(typeof v === 'number' ? v : '')}
                      disabled={!!activeScan}
                    />
                    <Button
                      leftSection={<IconPlayerPlay size={16} />}
                      onClick={startScan}
                      disabled={!!activeScan}
                      loading={!!activeScan && activeScan.status === 'queued'}
                    >
                      {activeScan ? (activeScan.status === 'queued' ? 'Sırada' : 'Full scan çalışıyor') : 'Full scan başlat'}
                    </Button>
                    {activeScan && (
                      <Button color="red" variant="light" leftSection={<IconPlayerStop size={16} />} onClick={() => cancelJob(activeScan.id)}>
                        İptal
                      </Button>
                    )}
                  </Group>
                  <Text size="xs" c="dimmed" maw={360}>
                    Tamamlanamayan projeler 3 geçişe kadar yeniden denenir; yarım kalan iş servis yeniden başlasa da kaldığı yerden sürer.
                  </Text>
                </Group>
              </Paper>

              <JobsPanel jobs={jobs} isLoading={isLoadingJobs} isConnected={isConnected} onCancel={cancelJob} onResume={resumeJob} />

              {lastScan && lastScanResult && <ScanSummary job={lastScan} result={lastScanResult} />}

              <ProjectsTable
                projects={projects}
                isLoading={isLoadingProjects}
                busy={isClearingCache}
                onClearCache={clearCache}
                onDeleteBuilds={setDeleteTarget}
                onDeleteBuildsBulk={setBulkDeleteTargets}
              />
            </Stack>
          </Grid.Col>

          <Grid.Col span={{ base: 12, lg: 4 }}>
            <div style={{ position: 'sticky', top: HEADER_HEIGHT + 16 }}>
              <LogPanel height={`calc(100vh - ${HEADER_HEIGHT + 32}px)`} />
            </div>
          </Grid.Col>
        </Grid>
      </AppShell.Main>

      <Modal opened={!!deleteTarget} onClose={() => setDeleteTarget(null)} title="Tüm build artifact'lerini sil" centered>
        <Stack gap="md">
          <Text size="sm">
            <Code>{deleteTarget?.name}</Code> projesinin <Text span fw={700}>tüm</Text> build artifact&apos;leri (APK, IPA vb.) Unity Cloud Build&apos;den kalıcı olarak silinecek.
          </Text>
          <Alert color="red" icon={<IconAlertTriangle size={18} />}>
            Bu işlem geri alınamaz. Build kayıtları Unity&apos;de kalır, dosyalar silinir. İş sıraya alınır ve Jobs panelinden izlenir.
          </Alert>
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setDeleteTarget(null)} disabled={isCreatingDelete}>Vazgeç</Button>
            <Button color="red" onClick={confirmDelete} loading={isCreatingDelete}>Artifact&apos;leri sil</Button>
          </Group>
        </Stack>
      </Modal>
      <Modal opened={!!bulkDeleteTargets} onClose={() => setBulkDeleteTargets(null)} title={`${bulkDeleteTargets?.length ?? 0} projenin tüm build artifact'lerini sil`} centered size="lg">
        <Stack gap="md">
          <Text size="sm">
            Aşağıdaki projelerin <Text span fw={700}>tüm</Text> build artifact&apos;leri Unity Cloud Build&apos;den kalıcı olarak silinecek.
            Toplam <Text span fw={700}>{bulkDeleteTargets?.reduce((s, p) => s + (p.artifactBuilds ?? 0), 0) ?? 0}</Text> artifact&apos;li build.
          </Text>
          <ScrollArea.Autosize mah={240}>
            <List size="sm" spacing={2}>
              {bulkDeleteTargets?.map(p => (
                <List.Item key={p.id}>
                  {p.name} <Text span c="dimmed" size="xs">({p.artifactBuilds ?? 0} artifact&apos;li build)</Text>
                </List.Item>
              ))}
            </List>
          </ScrollArea.Autosize>
          <Alert color="red" icon={<IconAlertTriangle size={18} />}>
            Bu işlem geri alınamaz. Projeler sırayla işlenir; iş yarım kalırsa tamamlananlar atlanarak devam eder. Sonunda sayılar tek bir org taramasıyla tazelenir.
          </Alert>
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setBulkDeleteTargets(null)} disabled={isCreatingDelete}>Vazgeç</Button>
            <Button color="red" onClick={confirmBulkDelete} loading={isCreatingDelete}>{bulkDeleteTargets?.length ?? 0} projenin artifact&apos;lerini sil</Button>
          </Group>
        </Stack>
      </Modal>
    </AppShell>
  );
}
