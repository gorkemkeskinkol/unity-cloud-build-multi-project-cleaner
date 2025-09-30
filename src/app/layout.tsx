import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Unity Cloud Build Multi-Project Cleaner',
  description: 'A dashboard/web UI tool for managing multiple Unity projects at once, letting you scan, monitor, and clean build artifacts across projects.',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <head>
        <style>{`
          * {
            box-sizing: border-box;
          }
          
          body {
            margin: 0;
            padding: 0;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen',
              'Ubuntu', 'Cantarell', 'Fira Sans', 'Droid Sans', 'Helvetica Neue',
              sans-serif;
            -webkit-font-smoothing: antialiased;
            -moz-osx-font-smoothing: grayscale;
            background-color: #f8f9fa;
            color: #212529;
            line-height: 1.6;
          }
          
          h1, h2, h3, h4, h5, h6 {
            margin-top: 0;
            margin-bottom: 0.5rem;
            font-weight: 500;
            line-height: 1.2;
          }
          
          p {
            margin-top: 0;
            margin-bottom: 1rem;
          }
          
          table {
            border-collapse: collapse;
            width: 100%;
          }
          
          th, td {
            text-align: left;
            padding: 8px;
            border-bottom: 1px solid #ddd;
          }
          
          input, button {
            font-family: inherit;
            font-size: inherit;
          }
          
          button:hover {
            opacity: 0.9;
          }
          
          button:disabled {
            opacity: 0.6;
            cursor: not-allowed;
          }
        `}</style>
      </head>
      <body>{children}</body>
    </html>
  )
}
