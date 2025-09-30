'use client';

import React, { createContext, useContext, useReducer, useCallback } from 'react';
import { LogEntry, LogLevel } from '@/types';

interface LogContextType {
  logs: LogEntry[];
  addLog: (level: LogLevel, message: string, details?: string, source?: string) => void;
  clearLogs: () => void;
  getLogsByLevel: (level: LogLevel) => LogEntry[];
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
    case 'ADD_LOG':
      const newLog: LogEntry = {
        id: state.nextId,
        level: action.payload.level,
        message: action.payload.message,
        details: action.payload.details,
        timestamp: new Date(),
        source: action.payload.source
      };

      return {
        logs: [newLog, ...state.logs],
        nextId: state.nextId + 1
      };

    case 'CLEAR_LOGS':
      return {
        logs: [],
        nextId: 1
      };

    default:
      return state;
  }
}

interface LogProviderProps {
  children: React.ReactNode;
}

export function LogProvider({ children }: LogProviderProps) {
  const [state, dispatch] = useReducer(logReducer, {
    logs: [],
    nextId: 1
  });

  const addLog = useCallback((
    level: LogLevel,
    message: string,
    details?: string,
    source?: string
  ) => {
    dispatch({
      type: 'ADD_LOG',
      payload: { level, message, details, source }
    });

    // Console'a da log'u yazdır (development için)
    if (process.env.NODE_ENV === 'development') {
      const logMethod = level === 'error' ? 'error' : 
                      level === 'warning' ? 'warn' : 
                      'log';
      console[logMethod](`[${source || 'APP'}] ${message}`, details || '');
    }
  }, []);

  const clearLogs = useCallback(() => {
    dispatch({ type: 'CLEAR_LOGS' });
  }, []);

  const getLogsByLevel = useCallback((level: LogLevel) => {
    return state.logs.filter(log => log.level === level);
  }, [state.logs]);

  const hasErrors = state.logs.some(log => log.level === 'error');

  const contextValue: LogContextType = {
    logs: state.logs,
    addLog,
    clearLogs,
    getLogsByLevel,
    hasErrors
  };

  return (
    <LogContext.Provider value={contextValue}>
      {children}
    </LogContext.Provider>
  );
}

export function useLog() {
  const context = useContext(LogContext);
  if (context === undefined) {
    throw new Error('useLog must be used within a LogProvider');
  }
  return context;
}

// Convenience hooks for specific log levels
export function useLogInfo() {
  const { addLog } = useLog();
  return useCallback((message: string, details?: string, source?: string) => {
    addLog('info', message, details, source);
  }, [addLog]);
}

export function useLogWarning() {
  const { addLog } = useLog();
  return useCallback((message: string, details?: string, source?: string) => {
    addLog('warning', message, details, source);
  }, [addLog]);
}

export function useLogError() {
  const { addLog } = useLog();
  return useCallback((message: string, details?: string, source?: string) => {
    addLog('error', message, details, source);
  }, [addLog]);
}

export function useLogSuccess() {
  const { addLog } = useLog();
  return useCallback((message: string, details?: string, source?: string) => {
    addLog('success', message, details, source);
  }, [addLog]);
}
