'use client';

import { createContext, useContext, useState, type ReactNode } from 'react';
import type { PackageManager } from '@/lib/package-manager';

const PackageManagerContext = createContext<{
  packageManager: PackageManager;
  setPackageManager: (pm: PackageManager) => void;
} | null>(null);

export function PackageManagerProvider({ children }: { children: ReactNode }) {
  const [packageManager, setPackageManager] = useState<PackageManager>('pnpm');

  return (
    <PackageManagerContext.Provider value={{ packageManager, setPackageManager }}>
      {children}
    </PackageManagerContext.Provider>
  );
}

export function usePackageManager() {
  const context = useContext(PackageManagerContext);
  if (!context) {
    throw new Error('usePackageManager must be used within PackageManagerProvider');
  }
  return context;
}
