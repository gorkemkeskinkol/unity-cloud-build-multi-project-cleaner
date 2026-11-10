'use client';

import { Alert, List, Paper, SimpleGrid, Stack, Text, Title } from '@mantine/core';
import { IconAlertTriangle } from '@tabler/icons-react';
import { JobRecord } from '@/types/jobs';

export interface FullScanResult {
  totalProjects: number;
  completedProjects: number;
  totalBuilds: number;
  artifactBuilds?: number;
  totalTargets: number;
  cachedProjects: number;
  freshProjects: number;
  passes: number;
  failedProjects: Array<{ projectId: string; projectName: string; status: string; errors: string[] }>;
}

function Stat({ label, value, hint, color }: { label: string; value: number | string; hint?: string; color?: string }) {
  return (
    <Paper p="md">
      <Text size="xs" c="dimmed" tt="uppercase" fw={600}>{label}</Text>
      <Text size="xl" fw={700} c={color}>{value}</Text>
      {hint && <Text size="xs" c="dimmed">{hint}</Text>}
    </Paper>
  );
}

export function ScanSummary({ job, result }: { job: JobRecord; result: FullScanResult }) {
  const failed = result.failedProjects ?? [];
  return (
    <Stack gap="sm">
      <Title order={5}>
        Son full scan{' '}
        <Text span size="xs" c="dimmed" fw={400}>
          {job.finishedAt ? new Date(job.finishedAt).toLocaleString('tr-TR') : ''}
        </Text>
      </Title>
      <SimpleGrid cols={{ base: 2, md: 4 }} spacing="sm">
        <Stat label="Proje" value={result.totalProjects} hint={`${result.cachedProjects} cache, ${result.freshProjects} yeni`} />
        <Stat label="Build" value={result.totalBuilds} hint={result.artifactBuilds !== undefined ? `${result.artifactBuilds} artifact'li` : undefined} />
        <Stat label="Target" value={result.totalTargets} />
        <Stat
          label="Tamamlanamayan"
          value={failed.length}
          hint={result.passes > 1 ? `${result.passes} geçiş yapıldı` : undefined}
          color={failed.length > 0 ? 'red' : 'green'}
        />
      </SimpleGrid>
      {failed.length > 0 && (
        <Alert color="red" icon={<IconAlertTriangle size={18} />} title={`${failed.length} proje tüm denemelere rağmen tamamlanamadı`}>
          <List size="sm" spacing={2}>
            {failed.map(p => (
              <List.Item key={p.projectId}>
                <Text span fw={600}>{p.projectName}</Text>
                <Text span c="dimmed"> ({p.status})</Text>
                {p.errors?.length > 0 && <Text span c="dimmed"> – {p.errors.slice(0, 2).join('; ')}</Text>}
              </List.Item>
            ))}
          </List>
          <Text size="xs" c="dimmed" mt="xs">Jobs panelindeki &quot;Eksikleri tekrar dene&quot; yalnızca bu projeleri tarar.</Text>
        </Alert>
      )}
    </Stack>
  );
}
