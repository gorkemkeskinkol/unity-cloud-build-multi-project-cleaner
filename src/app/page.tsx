'use client';

import { useEffect, useState } from 'react';
import { Center, Loader } from '@mantine/core';
import { CredentialManager } from '@/modules/config/credential-manager';
import { LogProvider } from '@/contexts/LogContext';
import { AppConfig } from '@/types';
import { SetupWizard } from '@/components/SetupWizard';
import { Dashboard } from '@/components/Dashboard';

export default function Home() {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    setConfig(CredentialManager.getCredentials());
    setIsLoading(false);
  }, []);

  if (isLoading) {
    return (
      <Center h="100vh">
        <Loader />
      </Center>
    );
  }

  return (
    <LogProvider>
      {config ? <Dashboard config={config} /> : <SetupWizard onComplete={setConfig} />}
    </LogProvider>
  );
}
