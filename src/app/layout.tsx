import type { Metadata } from 'next';
import { ColorSchemeScript, MantineProvider, mantineHtmlProps, createTheme } from '@mantine/core';
import { Notifications } from '@mantine/notifications';
import '@mantine/core/styles.css';
import '@mantine/notifications/styles.css';

export const metadata: Metadata = {
  title: 'Unity Cloud Build Cleaner',
  description: 'Unity Cloud Build projelerini toplu tara, izle ve build artifact\'lerini temizle.'
};

const theme = createTheme({
  primaryColor: 'indigo',
  defaultRadius: 'md',
  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  fontFamilyMonospace: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
  headings: { fontWeight: '600' },
  components: {
    Paper: { defaultProps: { withBorder: true } },
    Card: { defaultProps: { withBorder: true } }
  }
});

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="tr" {...mantineHtmlProps}>
      <head>
        <ColorSchemeScript defaultColorScheme="dark" />
      </head>
      <body>
        <MantineProvider theme={theme} defaultColorScheme="dark">
          <Notifications position="bottom-right" limit={4} />
          {children}
        </MantineProvider>
      </body>
    </html>
  );
}
