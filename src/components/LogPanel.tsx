'use client';

import { useMemo, useState } from 'react';
import { ActionIcon, Badge, Box, Group, Paper, ScrollArea, SegmentedControl, Stack, Text, TextInput, Tooltip } from '@mantine/core';
import { IconSearch, IconTrash } from '@tabler/icons-react';
import { useLog } from '@/contexts/LogContext';
import { LogEntry, LogLevel } from '@/types';

const LEVEL_COLOR: Record<LogLevel, string> = {
  info: 'blue',
  success: 'green',
  warning: 'yellow',
  error: 'red'
};

const LEVEL_LABEL: Record<LogLevel, string> = {
  info: 'INFO',
  success: 'OK',
  warning: 'UYARI',
  error: 'HATA'
};

type Filter = 'all' | 'warning' | 'error';

function formatTime(date: Date): string {
  return date.toLocaleTimeString('tr-TR', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function formatFull(date: Date): string {
  return date.toLocaleString('tr-TR', { hour12: false });
}

function LogRow({ log }: { log: LogEntry }) {
  const color = LEVEL_COLOR[log.level];
  return (
    <Box
      px="sm"
      py={6}
      style={{
        borderLeft: `3px solid var(--mantine-color-${color}-6)`,
        background: log.level === 'error' ? 'var(--mantine-color-red-light)' : log.level === 'warning' ? 'var(--mantine-color-yellow-light)' : 'transparent',
        borderRadius: 4
      }}
    >
      <Group gap={6} wrap="nowrap" align="flex-start">
        <Tooltip label={formatFull(log.timestamp)} openDelay={400}>
          <Text size="xs" c="dimmed" ff="monospace" style={{ whiteSpace: 'nowrap', paddingTop: 2 }}>
            {formatTime(log.timestamp)}
          </Text>
        </Tooltip>
        <Badge size="xs" color={color} variant="light" style={{ flexShrink: 0, marginTop: 2 }}>
          {LEVEL_LABEL[log.level]}
        </Badge>
        <Box style={{ minWidth: 0 }}>
          <Text size="sm" style={{ wordBreak: 'break-word' }}>{log.message}</Text>
          <Group gap={6}>
            {log.source && <Text size="xs" c="dimmed">{log.source}</Text>}
            {log.details && <Text size="xs" c="dimmed">{log.details}</Text>}
          </Group>
        </Box>
      </Group>
    </Box>
  );
}

export function LogPanel({ height }: { height: string }) {
  const { logs, clearLogs, counts } = useLog();
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return logs.filter(log => {
      if (filter === 'error' && log.level !== 'error') return false;
      if (filter === 'warning' && log.level !== 'warning' && log.level !== 'error') return false;
      if (q && !`${log.message} ${log.source ?? ''}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [logs, filter, query]);

  return (
    <Paper h={height} style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <Stack gap="xs" p="sm" style={{ borderBottom: '1px solid var(--mantine-color-default-border)' }}>
        <Group justify="space-between">
          <Group gap="xs">
            <Text fw={600}>Loglar</Text>
            {counts.error > 0 && <Badge color="red" size="sm" variant="filled">{counts.error} hata</Badge>}
            {counts.warning > 0 && <Badge color="yellow" size="sm" variant="light">{counts.warning} uyarı</Badge>}
          </Group>
          <Tooltip label="Logları temizle">
            <ActionIcon variant="subtle" color="gray" onClick={clearLogs} aria-label="Logları temizle">
              <IconTrash size={16} />
            </ActionIcon>
          </Tooltip>
        </Group>
        <Group gap="xs" wrap="nowrap">
          <SegmentedControl
            size="xs"
            value={filter}
            onChange={(v) => setFilter(v as Filter)}
            data={[
              { label: `Tümü (${logs.length})`, value: 'all' },
              { label: 'Uyarı+', value: 'warning' },
              { label: 'Hata', value: 'error' }
            ]}
          />
          <TextInput
            size="xs"
            placeholder="Ara..."
            leftSection={<IconSearch size={14} />}
            value={query}
            onChange={(e) => setQuery(e.currentTarget.value)}
            style={{ flex: 1 }}
          />
        </Group>
      </Stack>

      <ScrollArea style={{ flex: 1 }} type="auto">
        <Stack gap={4} p="xs">
          {visible.length === 0 ? (
            <Text size="sm" c="dimmed" fs="italic" p="sm">
              {logs.length === 0 ? 'Henüz log yok. Bir iş başlattığınızda burada akar.' : 'Filtreye uyan log yok.'}
            </Text>
          ) : (
            visible.map(log => <LogRow key={log.id} log={log} />)
          )}
        </Stack>
      </ScrollArea>
    </Paper>
  );
}
