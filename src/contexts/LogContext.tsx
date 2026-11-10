'use client';

import React, { createContext, useContext, useReducer, useCallback, useMemo } from 'react';
import { LogEntry, LogLevel } from '@/types';

/** Bellekte tutulan en fazla log sayısı (eskiler düşer) */
const MAX_LOGS = 1000;

interface LogContextType {
  logs: LogEntry[];
  /** source: hangi modül ("Jobs", "ScanOrchestrator"...), details: isteğe bağlı ek satır */
  addLog: (level: LogLevel, message: string, source?: string, details?: string) => void;
  clearLogs: () => void;
  counts: Record<LogLevel, number>;
  hasErrors: boolean;
}

interface LogState {
  logs: LogEntry[];
  nextId: number;
}

type LogAction =
  | { type: 'ADD_LOG'; payload: { level: LogLevel; message: string; details?: string; source?: string } }
  | { type: 'CLEAR_LOGS' };

const LogContext = createContext<LogContextType | undefined>(undefined);

function logReducer(state: LogState, action: LogAction): LogState {
  switch (action.type) {
    case 'ADD_LOG': {
      const entry: LogEntry = {
        id: state.nextId,
        level: action.payload.level,
        message: action.payload.message,
        details: action.payload.details,
        timestamp: new Date(),
        source: action.payload.source
      };
      const logs = [entry, ...state.logs];
      if (logs.length > MAX_LOGS) logs.length = MAX_LOGS;
      return { logs, nextId: state.nextId + 1 };
    }
    case 'CLEAR_LOGS':
      return { logs: [], nextId: 1 };
    default:
      return state;
  }
}

export function LogProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(logReducer, { logs: [], nextId: 1 });

  const addLog = useCallback((level: LogLevel, message: string, source?: string, details?: string) => {
    dispatch({ type: 'ADD_LOG', payload: { level, message, details, source } });
    if (process.env.NODE_ENV === 'development') {
      const method = level === 'error' ? 'error' : level === 'warning' ? 'warn' : 'log';
      console[method](`[${source || 'APP'}] ${message}`, details || '');
    }
  }, []);

  const clearLogs = useCallback(() => dispatch({ type: 'CLEAR_LOGS' }), []);

  const counts = useMemo(() => {
    const c: Record<LogLevel, number> = { info: 0, warning: 0, error: 0, success: 0 };
    for (const log of state.logs) c[log.level]++;
    return c;
  }, [state.logs]);

  const value: LogContextType = {
    logs: state.logs,
    addLog,
    clearLogs,
    counts,
    hasErrors: counts.error > 0
  };

  return <LogContext.Provider value={value}>{children}</LogContext.Provider>;
}

export function useLog() {
  const context = useContext(LogContext);
  if (context === undefined) {
    throw new Error('useLog must be used within a LogProvider');
  }
  return context;
}
