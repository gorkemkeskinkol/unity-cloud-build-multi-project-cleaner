'use client';

import { useMemo, useState } from 'react';
import {
  ActionIcon, Badge, Button, Checkbox, Group, Menu, Paper, ScrollArea, Table, Text, TextInput, Title, Tooltip, UnstyledButton
} from '@mantine/core';
import { IconDatabaseOff, IconDotsVertical, IconSearch, IconSortAscending, IconSortDescending, IconTrash } from '@tabler/icons-react';

export interface CachedProject {
  id: string;
  name: string;
  platforms?: string[];
  totalBuilds?: number;
  /** artifact'i hâlâ duran build sayısı */
  artifactBuilds?: number;
  lastScannedAt?: string;
}

type SortField = 'name' | 'totalBuilds' | 'artifactBuilds' | 'lastScannedAt';

interface Props {
  projects: CachedProject[];
  isLoading: boolean;
  busy: boolean;
  onClearCache: (projectIds: string[]) => void;
  onDeleteBuilds: (project: CachedProject) => void;
  onDeleteBuildsBulk: (projects: CachedProject[]) => void;
}

export function ProjectsTable({ projects, isLoading, busy, onClearCache, onDeleteBuilds, onDeleteBuildsBulk }: Props) {
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<{ field: SortField; dir: 'asc' | 'desc' }>({ field: 'artifactBuilds', dir: 'desc' });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [lastIndex, setLastIndex] = useState<number | null>(null);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q ? projects.filter(p => p.name.toLowerCase().includes(q)) : projects;
    const sign = sort.dir === 'asc' ? 1 : -1;
    return [...filtered].sort((a, b) => {
      let cmp = 0;
      if (sort.field === 'name') cmp = a.name.localeCompare(b.name);
      else if (sort.field === 'totalBuilds') cmp = (a.totalBuilds ?? 0) - (b.totalBuilds ?? 0);
      else if (sort.field === 'artifactBuilds') cmp = (a.artifactBuilds ?? 0) - (b.artifactBuilds ?? 0);
      else cmp = (a.lastScannedAt ? Date.parse(a.lastScannedAt) : 0) - (b.lastScannedAt ? Date.parse(b.lastScannedAt) : 0);
      if (cmp === 0) cmp = a.name.localeCompare(b.name);
      return cmp * sign;
    });
  }, [projects, query, sort]);

  const totalBuilds = useMemo(() => projects.reduce((s, p) => s + (p.totalBuilds ?? 0), 0), [projects]);
  const totalArtifacts = useMemo(() => projects.reduce((s, p) => s + (p.artifactBuilds ?? 0), 0), [projects]);
  const selectedProjects = useMemo(() => projects.filter(p => selected.has(p.id)), [projects, selected]);

  const toggleSort = (field: SortField) => {
    setSort(prev => prev.field === field
      ? { field, dir: prev.dir === 'desc' ? 'asc' : 'desc' }
      : { field, dir: field === 'name' ? 'asc' : 'desc' });
  };

  const allVisibleSelected = rows.length > 0 && rows.every(r => selected.has(r.id));
  const someSelected = rows.some(r => selected.has(r.id));

  const toggleAll = () => {
    const next = new Set(selected);
    if (allVisibleSelected) rows.forEach(r => next.delete(r.id));
    else rows.forEach(r => next.add(r.id));
    setSelected(next);
  };

  /** Shift+tık: son tıklanan ile bu satır arasındaki aralığı toplu seç/bırak */
  const toggleOne = (index: number, shift: boolean) => {
    const next = new Set(selected);
    if (shift && lastIndex !== null && lastIndex !== index) {
      const [from, to] = lastIndex < index ? [lastIndex + 1, index] : [index, lastIndex - 1];
      for (let i = from; i <= to; i++) {
        const id = rows[i].id;
        if (next.has(id)) next.delete(id); else next.add(id);
      }
    } else {
      const id = rows[index].id;
      if (next.has(id)) next.delete(id); else next.add(id);
    }
    setSelected(next);
    setLastIndex(index);
  };

  const SortHeader = ({ field, children, align }: { field: SortField; children: React.ReactNode; align?: 'right' }) => (
    <Table.Th style={{ textAlign: align }}>
      <UnstyledButton onClick={() => toggleSort(field)} style={{ fontWeight: 600, fontSize: 'inherit', color: 'inherit' }}>
        <Group gap={4} wrap="nowrap" justify={align === 'right' ? 'flex-end' : undefined}>
          {children}
          {sort.field === field && (sort.dir === 'desc' ? <IconSortDescending size={14} /> : <IconSortAscending size={14} />)}
        </Group>
      </UnstyledButton>
    </Table.Th>
  );

  return (
    <Paper>
      <Group justify="space-between" p="sm" style={{ borderBottom: '1px solid var(--mantine-color-default-border)' }}>
        <Group gap="sm">
          <Title order={5}>Projeler</Title>
          <Badge variant="light" color="gray">{projects.length}</Badge>
          <Text size="xs" c="dimmed">{totalBuilds} build · {totalArtifacts} artifact&apos;li</Text>
        </Group>
        <Group gap="xs">
          {selected.size > 0 && (
            <>
              <Button
                size="xs"
                color="red"
                leftSection={<IconTrash size={14} />}
                disabled={busy}
                onClick={() => onDeleteBuildsBulk(selectedProjects)}
              >
                Seçili {selected.size} projenin artifact&apos;lerini sil
              </Button>
              <Button
                size="xs"
                color="gray"
                variant="light"
                leftSection={<IconDatabaseOff size={14} />}
                loading={busy}
                onClick={() => { onClearCache(Array.from(selected)); setSelected(new Set()); }}
              >
                Cache&apos;ten çıkar
              </Button>
            </>
          )}
          <TextInput
            size="xs"
            placeholder="Proje ara..."
            leftSection={<IconSearch size={14} />}
            value={query}
            onChange={(e) => setQuery(e.currentTarget.value)}
            w={220}
          />
        </Group>
      </Group>

      <ScrollArea.Autosize mah="60vh">
        <Table striped highlightOnHover stickyHeader verticalSpacing="xs" fz="sm">
          <Table.Thead>
            <Table.Tr>
              <Table.Th w={36}>
                <Checkbox size="xs" checked={allVisibleSelected} indeterminate={someSelected && !allVisibleSelected} onChange={toggleAll} aria-label="Tümünü seç" />
              </Table.Th>
              <SortHeader field="name">Proje</SortHeader>
              <Table.Th>Platform</Table.Th>
              <SortHeader field="totalBuilds" align="right">Build</SortHeader>
              <SortHeader field="artifactBuilds" align="right">Artifact&apos;li</SortHeader>
              <SortHeader field="lastScannedAt">Son tarama</SortHeader>
              <Table.Th w={40} />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {isLoading ? (
              <Table.Tr><Table.Td colSpan={7}><Text size="sm" c="dimmed">Yükleniyor...</Text></Table.Td></Table.Tr>
            ) : rows.length === 0 ? (
              <Table.Tr>
                <Table.Td colSpan={7}>
                  <Text size="sm" c="dimmed" fs="italic" py="md" ta="center">
                    {projects.length === 0 ? 'Henüz taranmış proje yok. Full scan başlatın.' : 'Aramaya uyan proje yok.'}
                  </Text>
                </Table.Td>
              </Table.Tr>
            ) : rows.map((project, index) => (
              <Table.Tr key={project.id} bg={selected.has(project.id) ? 'var(--mantine-color-indigo-light)' : undefined}>
                <Table.Td>
                  <Checkbox
                    size="xs"
                    checked={selected.has(project.id)}
                    onChange={() => { /* onClick shift bilgisini taşır */ }}
                    onClick={(e) => toggleOne(index, e.shiftKey)}
                    aria-label={`${project.name} seç`}
                  />
                </Table.Td>
                <Table.Td>
                  <Text size="sm" fw={500}>{project.name}</Text>
                </Table.Td>
                <Table.Td>
                  <Group gap={4}>
                    {project.platforms?.length ? project.platforms.map(p => <Badge key={p} size="xs" variant="outline" color="gray">{p}</Badge>) : <Text size="xs" c="dimmed">-</Text>}
                  </Group>
                </Table.Td>
                <Table.Td style={{ textAlign: 'right' }}>
                  <Text size="sm" c="dimmed">{project.totalBuilds ?? 0}</Text>
                </Table.Td>
                <Table.Td style={{ textAlign: 'right' }}>
                  <Tooltip label="Artifact'i (APK/IPA vb.) hâlâ duran başarılı build sayısı; silme sonrası sıfıra iner">
                    <Text size="sm" fw={600} c={(project.artifactBuilds ?? 0) === 0 ? 'dimmed' : (project.artifactBuilds ?? 0) >= 50 ? 'orange' : undefined}>
                      {project.artifactBuilds ?? 0}
                    </Text>
                  </Tooltip>
                </Table.Td>
                <Table.Td>
                  <Text size="xs" c="dimmed">{project.lastScannedAt ? new Date(project.lastScannedAt).toLocaleString('tr-TR', { hour12: false }) : '-'}</Text>
                </Table.Td>
                <Table.Td>
                  <Menu position="bottom-end" withinPortal shadow="md">
                    <Menu.Target>
                      <Tooltip label="İşlemler">
                        <ActionIcon variant="subtle" color="gray" disabled={busy} aria-label="İşlemler">
                          <IconDotsVertical size={16} />
                        </ActionIcon>
                      </Tooltip>
                    </Menu.Target>
                    <Menu.Dropdown>
                      <Menu.Item color="red" leftSection={<IconTrash size={14} />} onClick={() => onDeleteBuilds(project)}>
                        Tüm build artifact&apos;lerini sil
                      </Menu.Item>
                      <Menu.Item leftSection={<IconDatabaseOff size={14} />} onClick={() => onClearCache([project.id])}>
                        Cache&apos;ten çıkar (yeniden taranır)
                      </Menu.Item>
                    </Menu.Dropdown>
                  </Menu>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </ScrollArea.Autosize>
    </Paper>
  );
}
