'use client';

import { useState } from 'react';
import { Anchor, Button, Card, Center, List, PasswordInput, Stack, Text, TextInput, ThemeIcon, Title } from '@mantine/core';
import { IconCloudUpload } from '@tabler/icons-react';
import { CredentialManager } from '@/modules/config/credential-manager';
import { AppConfig } from '@/types';

export function SetupWizard({ onComplete }: { onComplete: (config: AppConfig) => void }) {
  const [orgId, setOrgId] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [error, setError] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!CredentialManager.validateOrgIdFormat(orgId)) {
      setError('Organization ID formatı geçersiz');
      return;
    }
    if (!CredentialManager.validateApiKeyFormat(apiKey)) {
      setError('API Key formatı geçersiz (en az 20 karakter)');
      return;
    }
    CredentialManager.storeCredentials(orgId, apiKey);
    const config = CredentialManager.getCredentials();
    if (config) onComplete(config);
  };

  return (
    <Center mih="100vh" p="md">
      <Card w={460} p="xl" shadow="md">
        <form onSubmit={handleSubmit}>
          <Stack gap="md">
            <Center>
              <ThemeIcon size={56} radius="xl" variant="light">
                <IconCloudUpload size={30} />
              </ThemeIcon>
            </Center>
            <Title order={3} ta="center">Unity Cloud Build Cleaner</Title>
            <Text c="dimmed" size="sm" ta="center">
              Kimlik bilgileri yalnızca bu tarayıcıda saklanır; sunucu veritabanına yazılmaz.
            </Text>

            <TextInput
              label="Organization ID"
              placeholder="18966672297045"
              value={orgId}
              onChange={(e) => setOrgId(e.currentTarget.value)}
              required
              autoFocus
            />
            <PasswordInput
              label="Build Automation API Key"
              placeholder="••••••••••••••••••••"
              value={apiKey}
              onChange={(e) => setApiKey(e.currentTarget.value)}
              required
              error={error || undefined}
            />

            <Button type="submit" fullWidth>Kaydet ve devam et</Button>

            <Text size="xs" c="dimmed">
              API key nerede?
            </Text>
            <List size="xs" c="dimmed" spacing={4}>
              <List.Item><Anchor href="https://cloud.unity.com" target="_blank" size="xs">cloud.unity.com</Anchor> → Projects → bir proje → DevOps → Build Automation</List.Item>
              <List.Item>Settings → General → API settings</List.Item>
              <List.Item>Organization ID: Administration → Settings</List.Item>
            </List>
          </Stack>
        </form>
      </Card>
    </Center>
  );
}
